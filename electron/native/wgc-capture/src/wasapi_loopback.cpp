#include "wasapi_loopback.h"
#include <functiondiscoverykeys_devpkey.h>
#include <avrt.h>
#include <timeapi.h>
#include <iostream>
#include <cstring>
#include <algorithm>
#include <cmath>
#include <cwctype>

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "avrt.lib")
#pragma comment(lib, "winmm.lib")

namespace {
constexpr int64_t kHundredNanosecondsPerSecond = 10000000;
constexpr uint64_t kSilenceWriteChunkFrames = 4096;
constexpr uint32_t kMinimumGapFillThresholdMs = 50;
// Wireless headsets can flag short WASAPI discontinuities that are less audible
// when compacted and later duration-corrected than when rendered as hard silence.
constexpr uint32_t kDiscontinuityGapFillThresholdMs = 140;
constexpr uint32_t kSilentDiscontinuityCompactThresholdMs = 40;
constexpr uint32_t kBoundaryFadeInMs = 5;
// The shared-mode buffer is how long the capture loop may be late before
// audio is lost. 20 ms was easily exceeded on busy, low-spec PCs (video
// encoding, a slow disk, the 15.6 ms default Windows timer), which dropped
// audio and made voices sound broken. 200 ms adds no recording latency: the
// loop still drains packets every few milliseconds.
constexpr REFERENCE_TIME kSharedBufferDurationHns = 2000000; // 200 ms
constexpr DWORD kPollIntervalMs = 5;
// A microphone stream delivers a packet every ~10 ms. If none arrive for this
// long, Windows has stalled the stream and it is reopened. (System audio is
// exempt: loopback sends nothing while the PC is silent.)
constexpr int64_t kMicStallTimeoutHns = 20000000; // 2 s
constexpr DWORD kReopenRetryMs = 500;

int64_t queryPerformanceCounterHns() {
    LARGE_INTEGER counter;
    LARGE_INTEGER frequency;
    if (!QueryPerformanceCounter(&counter) || !QueryPerformanceFrequency(&frequency) || frequency.QuadPart <= 0) {
        return 0;
    }

    return static_cast<int64_t>(
        (static_cast<long double>(counter.QuadPart) * 10000000.0L) /
        static_cast<long double>(frequency.QuadPart));
}

bool isFloatFormat(const WAVEFORMATEX* format) {
    if (!format) return false;
    if (format->wFormatTag == WAVE_FORMAT_IEEE_FLOAT) return true;
    if (format->wFormatTag != WAVE_FORMAT_EXTENSIBLE) return false;
    return reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(format)->SubFormat ==
        KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;
}

bool isPcmFormat(const WAVEFORMATEX* format) {
    if (!format) return false;
    if (format->wFormatTag == WAVE_FORMAT_PCM) return true;
    if (format->wFormatTag != WAVE_FORMAT_EXTENSIBLE) return false;
    return reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(format)->SubFormat ==
        KSDATAFORMAT_SUBTYPE_PCM;
}

int16_t pcm24ToInt16(const BYTE* sample) {
    int32_t value = static_cast<int32_t>(sample[0]) |
        (static_cast<int32_t>(sample[1]) << 8) |
        (static_cast<int32_t>(sample[2]) << 16);
    if ((value & 0x800000) != 0) {
        value |= ~0xFFFFFF;
    }
    return static_cast<int16_t>(value >> 8);
}

std::wstring normalizeDeviceName(const std::wstring& value) {
    std::wstring result;
    result.reserve(value.size());
    bool lastWasSpace = true;
    for (const wchar_t character : value) {
        if (std::iswalnum(character)) {
            result.push_back(static_cast<wchar_t>(std::towlower(character)));
            lastWasSpace = false;
        } else if (!lastWasSpace) {
            result.push_back(L' ');
            lastWasSpace = true;
        }
    }
    if (!result.empty() && result.back() == L' ') result.pop_back();
    return result;
}

bool deviceNamesMatch(
    const std::wstring& candidateName,
    const std::wstring& requestedName) {
    const std::wstring candidate = normalizeDeviceName(candidateName);
    const std::wstring requested = normalizeDeviceName(requestedName);
    return !candidate.empty() && candidate == requested;
}

enum class DeviceRole { None, Default, Communications };

// Chromium lists the Windows default devices as "Default - <name>" and
// "Communications - <name>". Strip that prefix so the native helper opens the
// same microphone the user picked.
std::wstring stripRolePrefix(const std::wstring& label, DeviceRole* role) {
    static const std::wstring kDefault = L"Default - ";
    static const std::wstring kCommunications = L"Communications - ";
    if (label.rfind(kDefault, 0) == 0) {
        if (role) *role = DeviceRole::Default;
        return label.substr(kDefault.size());
    }
    if (label.rfind(kCommunications, 0) == 0) {
        if (role) *role = DeviceRole::Communications;
        return label.substr(kCommunications.size());
    }
    if (role) *role = DeviceRole::None;
    return label;
}

std::wstring getDeviceFriendlyName(IMMDevice* device) {
    if (!device) return L"";
    IPropertyStore* store = nullptr;
    if (FAILED(device->OpenPropertyStore(STGM_READ, &store)) || !store) return L"";
    PROPVARIANT value;
    PropVariantInit(&value);
    const HRESULT hr = store->GetValue(PKEY_Device_FriendlyName, &value);
    std::wstring name;
    if (SUCCEEDED(hr) && value.vt == VT_LPWSTR && value.pwszVal) name = value.pwszVal;
    PropVariantClear(&value);
    store->Release();
    return name;
}
}

static const CLSID CLSID_MMDeviceEnumerator_ = __uuidof(MMDeviceEnumerator);
static const IID IID_IMMDeviceEnumerator_ = __uuidof(IMMDeviceEnumerator);
static const IID IID_IAudioClient_ = __uuidof(IAudioClient);
static const IID IID_IAudioCaptureClient_ = __uuidof(IAudioCaptureClient);

WasapiCapture::WasapiCapture() {}

WasapiCapture::~WasapiCapture() {
    stop();
    if (mixFormat_) CoTaskMemFree(mixFormat_);
    if (captureClient_) captureClient_->Release();
    if (audioClient_) audioClient_->Release();
    if (device_) device_->Release();
    if (enumerator_) enumerator_->Release();
}

static std::wstring utf8ToWide(const std::string& str) {
    if (str.empty()) return L"";
    int len = MultiByteToWideChar(CP_UTF8, 0, str.c_str(), static_cast<int>(str.size()), nullptr, 0);
    std::wstring wstr(len, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, str.c_str(), static_cast<int>(str.size()), &wstr[0], len);
    return wstr;
}

IMMDevice* WasapiCapture::findCaptureDeviceByName(const std::wstring& targetName) {
    IMMDeviceCollection* collection = nullptr;
    HRESULT hr = enumerator_->EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE, &collection);
    if (FAILED(hr)) return nullptr;

    UINT count = 0;
    collection->GetCount(&count);

    IMMDevice* matchingDevice = nullptr;
    for (UINT i = 0; i < count; i++) {
        IMMDevice* dev = nullptr;
        if (FAILED(collection->Item(i, &dev)) || !dev) continue;

        const std::wstring candidateName = getDeviceFriendlyName(dev);
        if (deviceNamesMatch(candidateName, targetName)) {
            if (matchingDevice) {
                matchingDevice->Release();
                dev->Release();
                collection->Release();
                return nullptr;
            }
            matchingDevice = dev;
            continue;
        }
        dev->Release();
    }

    collection->Release();
    return matchingDevice;
}

bool WasapiCapture::initializeLoopback(const std::string& outputPath) {
    outputPath_ = outputPath;
    streamFlags_ = AUDCLNT_STREAMFLAGS_LOOPBACK;

    HRESULT hr = CoCreateInstance(
        CLSID_MMDeviceEnumerator_, nullptr, CLSCTX_ALL,
        IID_IMMDeviceEnumerator_, reinterpret_cast<void**>(&enumerator_));
    if (FAILED(hr)) return false;

    hr = enumerator_->GetDefaultAudioEndpoint(eRender, eConsole, &device_);
    if (FAILED(hr)) return false;

    dataFlow_ = eRender;
    defaultRole_ = eConsole;
    followDefaultDevice_ = true;
    rememberDeviceId();
    return initializeCommon();
}

bool WasapiCapture::initializeMic(
    const std::string& outputPath,
    const std::string& deviceId,
    const std::string& deviceName) {
    outputPath_ = outputPath;
    streamFlags_ = 0;

    HRESULT hr = CoCreateInstance(
        CLSID_MMDeviceEnumerator_, nullptr, CLSCTX_ALL,
        IID_IMMDeviceEnumerator_, reinterpret_cast<void**>(&enumerator_));
    if (FAILED(hr)) return false;

    DeviceRole labelRole = DeviceRole::None;
    const std::wstring plainName = stripRolePrefix(utf8ToWide(deviceName), &labelRole);

    dataFlow_ = eCapture;
    defaultRole_ = eConsole;
    followDefaultDevice_ = false;

    // Chromium's special device ids map to the Windows default endpoints.
    if (deviceId == "communications") {
        hr = enumerator_->GetDefaultAudioEndpoint(eCapture, eCommunications, &device_);
        if (FAILED(hr)) device_ = nullptr;
        defaultRole_ = eCommunications;
        followDefaultDevice_ = device_ != nullptr;
    } else if (deviceId == "default") {
        hr = enumerator_->GetDefaultAudioEndpoint(eCapture, eConsole, &device_);
        if (FAILED(hr)) device_ = nullptr;
        followDefaultDevice_ = device_ != nullptr;
    }

    if (!device_ && !deviceId.empty() && deviceId != "default" && deviceId != "communications") {
        const std::wstring requestedId = utf8ToWide(deviceId);
        hr = enumerator_->GetDevice(requestedId.c_str(), &device_);
        if (FAILED(hr)) device_ = nullptr;
    }
    if (!device_ && !plainName.empty()) {
        device_ = findCaptureDeviceByName(plainName);
    }
    if (!device_ && labelRole != DeviceRole::None) {
        defaultRole_ = labelRole == DeviceRole::Communications ? eCommunications : eConsole;
        hr = enumerator_->GetDefaultAudioEndpoint(eCapture, defaultRole_, &device_);
        if (FAILED(hr)) device_ = nullptr;
        followDefaultDevice_ = device_ != nullptr;
    }
    if (!device_) {
        const bool wantedSpecificDevice =
            deviceId != "default" && deviceId != "communications" &&
            (!deviceId.empty() || !deviceName.empty());
        if (wantedSpecificDevice) {
            std::cerr << "WARNING: Requested microphone unavailable" << std::endl;
            return false;
        }
        hr = enumerator_->GetDefaultAudioEndpoint(eCapture, eConsole, &device_);
        if (FAILED(hr)) return false;
        defaultRole_ = eConsole;
        followDefaultDevice_ = true;
    }

    const std::wstring openedName = getDeviceFriendlyName(device_);
    std::wcerr << L"Microphone: " << openedName << std::endl;
    rememberDeviceId();

    return initializeCommon();
}

void WasapiCapture::rememberDeviceId() {
    deviceIdString_.clear();
    if (!device_) return;
    LPWSTR id = nullptr;
    if (SUCCEEDED(device_->GetId(&id)) && id) {
        deviceIdString_ = id;
        CoTaskMemFree(id);
    }
}

bool WasapiCapture::reopenStream() {
    std::lock_guard<std::mutex> lock(clientMutex_);

    if (captureClient_) {
        captureClient_->Release();
        captureClient_ = nullptr;
    }
    if (audioClient_) {
        audioClient_->Stop();
        audioClient_->Release();
        audioClient_ = nullptr;
    }

    IMMDevice* device = nullptr;
    if (followDefaultDevice_) {
        if (FAILED(enumerator_->GetDefaultAudioEndpoint(dataFlow_, defaultRole_, &device))) {
            device = nullptr;
        }
    }
    if (!device && !deviceIdString_.empty()) {
        if (FAILED(enumerator_->GetDevice(deviceIdString_.c_str(), &device))) {
            device = nullptr;
        }
    }
    if (!device) {
        // The chosen device is gone; keep recording from the Windows default.
        if (FAILED(enumerator_->GetDefaultAudioEndpoint(dataFlow_, defaultRole_, &device))) {
            return false;
        }
    }

    // Open a fresh client in the file's format. If the device's own format
    // changed, Windows converts (AUTOCONVERTPCM) so the WAV stays consistent.
    auto openClient = [&](DWORD extraFlags, IAudioClient** out) -> HRESULT {
        IAudioClient* client = nullptr;
        HRESULT hr = device->Activate(
            IID_IAudioClient_, CLSCTX_ALL, nullptr, reinterpret_cast<void**>(&client));
        if (FAILED(hr)) return hr;
        hr = client->Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            streamFlags_ | extraFlags,
            kSharedBufferDurationHns, 0, mixFormat_, nullptr);
        if (FAILED(hr)) {
            client->Release();
            return hr;
        }
        *out = client;
        return S_OK;
    };

    IAudioClient* client = nullptr;
    HRESULT hr = openClient(0, &client);
    if (FAILED(hr)) {
        hr = openClient(
            AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
            &client);
    }
    if (FAILED(hr)) {
        std::cerr << "WASAPI: reopen Initialize failed hr=0x" << std::hex << hr << std::dec << std::endl;
        device->Release();
        return false;
    }

    IAudioCaptureClient* capture = nullptr;
    hr = client->GetService(IID_IAudioCaptureClient_, reinterpret_cast<void**>(&capture));
    if (FAILED(hr)) {
        client->Release();
        device->Release();
        return false;
    }
    client->GetBufferSize(&bufferFrameCount_);
    if (!paused_) {
        hr = client->Start();
        if (FAILED(hr)) {
            capture->Release();
            client->Release();
            device->Release();
            return false;
        }
    }

    if (device_) device_->Release();
    device_ = device;
    audioClient_ = client;
    captureClient_ = capture;
    rememberDeviceId();
    fadeInFramesRemaining_ = boundaryFadeInFrameCount();
    return true;
}

bool WasapiCapture::initializeCommon() {
    HRESULT hr = device_->Activate(IID_IAudioClient_, CLSCTX_ALL, nullptr,
                                    reinterpret_cast<void**>(&audioClient_));
    if (FAILED(hr)) return false;

    hr = audioClient_->GetMixFormat(&mixFormat_);
    if (FAILED(hr)) return false;

    hr = audioClient_->Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        streamFlags_,
        kSharedBufferDurationHns, 0, mixFormat_, nullptr);
    if (FAILED(hr)) return false;

    hr = audioClient_->GetBufferSize(&bufferFrameCount_);
    if (FAILED(hr)) return false;

    hr = audioClient_->GetService(IID_IAudioCaptureClient_,
                                   reinterpret_cast<void**>(&captureClient_));
    if (FAILED(hr)) return false;

    return true;
}

bool WasapiCapture::start() {
    if (capturing_) return true;

    outputFile_ = CreateFileA(
        outputPath_.c_str(), GENERIC_WRITE, 0, nullptr,
        CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);

    if (outputFile_ == INVALID_HANDLE_VALUE) {
        std::cerr << "ERROR: Cannot create audio output file" << std::endl;
        return false;
    }

    totalDataBytes_ = 0;
    framesWritten_ = 0;
    firstPacketQpcHns_ = -1;
    pauseStartQpcHns_ = 0;
    accumulatedPausedQpcHns_ = 0;
    dataDiscontinuityCount_ = 0;
    timestampErrorCount_ = 0;
    gapFillCount_ = 0;
    insertedSilenceFrames_ = 0;
    compactedDiscontinuityCount_ = 0;
    compactedDiscontinuityFrames_ = 0;
    compactedSilentDiscontinuityCount_ = 0;
    compactedSilentDiscontinuityFrames_ = 0;
    fadeInFramesRemaining_ = 0;
    bytesOnDisk_ = 0;
    streamRestartCount_ = 0;
    silentPacketFrames_ = 0;
    writeWavHeader(outputFile_, 0);

    HRESULT hr = audioClient_->Start();
    if (FAILED(hr)) {
        CloseHandle(outputFile_);
        outputFile_ = INVALID_HANDLE_VALUE;
        return false;
    }

    {
        std::lock_guard<std::mutex> lock(writeMutex_);
        writeQueue_.clear();
        writerStop_ = false;
    }
    writer_ = std::thread(&WasapiCapture::writerThread, this);

    capturing_ = true;
    paused_ = false;
    thread_ = std::thread(&WasapiCapture::captureThread, this);
    return true;
}

bool WasapiCapture::pause() {
    if (!capturing_ || paused_) return true;
    pauseStartQpcHns_ = queryPerformanceCounterHns();
    paused_ = true;
    std::lock_guard<std::mutex> lock(clientMutex_);
    return audioClient_ ? SUCCEEDED(audioClient_->Stop()) : false;
}

bool WasapiCapture::resume() {
    if (!capturing_ || !paused_) return true;
    const int64_t resumedQpcHns = queryPerformanceCounterHns();
    const int64_t pauseStartQpcHns = pauseStartQpcHns_.load();
    HRESULT hr = E_FAIL;
    {
        std::lock_guard<std::mutex> lock(clientMutex_);
        hr = audioClient_ ? audioClient_->Start() : E_FAIL;
    }
    // If the stream died while paused, the capture loop reopens it; resuming
    // must still succeed so the recording continues.
    if (FAILED(hr) && hr != AUDCLNT_E_DEVICE_INVALIDATED && hr != AUDCLNT_E_NOT_INITIALIZED) {
        return false;
    }
    if (pauseStartQpcHns > 0 && resumedQpcHns > pauseStartQpcHns) {
        accumulatedPausedQpcHns_.fetch_add(resumedQpcHns - pauseStartQpcHns);
    }
    pauseStartQpcHns_ = 0;
    paused_ = false;
    fadeInFramesRemaining_ = boundaryFadeInFrameCount();
    return true;
}

void WasapiCapture::stop() {
    if (!capturing_) return;
    capturing_ = false;
    if (thread_.joinable()) thread_.join();
    {
        std::lock_guard<std::mutex> lock(clientMutex_);
        if (audioClient_) audioClient_->Stop();
    }

    {
        std::lock_guard<std::mutex> lock(writeMutex_);
        writerStop_ = true;
    }
    writeCv_.notify_all();
    if (writer_.joinable()) writer_.join();

    if (outputFile_ != INVALID_HANDLE_VALUE) {
        SetFilePointer(outputFile_, 0, nullptr, FILE_BEGIN);
        const uint64_t dataBytes = bytesOnDisk_.load();
        const DWORD wavDataBytes =
            static_cast<DWORD>(std::min<uint64_t>(dataBytes, 0xFFFFFFFFu));
        writeWavHeader(outputFile_, wavDataBytes);
        CloseHandle(outputFile_);
        outputFile_ = INVALID_HANDLE_VALUE;
    }

    paused_ = false;
    pauseStartQpcHns_ = 0;
    accumulatedPausedQpcHns_ = 0;
    fadeInFramesRemaining_ = 0;
}

static int16_t floatToInt16(float v) {
    v = v < -1.0f ? -1.0f : (v > 1.0f ? 1.0f : v);
    return static_cast<int16_t>(v * 32767.0f);
}

bool WasapiCapture::writeWavHeader(HANDLE file, DWORD dataSize) {
    WORD channels = static_cast<WORD>(mixFormat_->nChannels);
    DWORD sampleRate = mixFormat_->nSamplesPerSec;
    WORD bitsPerSample = 16;
    WORD blockAlign = channels * (bitsPerSample / 8);
    DWORD byteRate = sampleRate * blockAlign;

    DWORD written;
    WriteFile(file, "RIFF", 4, &written, nullptr);
    DWORD chunkSize = 36 + dataSize;
    WriteFile(file, &chunkSize, 4, &written, nullptr);
    WriteFile(file, "WAVE", 4, &written, nullptr);
    WriteFile(file, "fmt ", 4, &written, nullptr);
    DWORD fmtSize = 16;
    WriteFile(file, &fmtSize, 4, &written, nullptr);
    WORD audioFormat = 1;
    WriteFile(file, &audioFormat, 2, &written, nullptr);
    WriteFile(file, &channels, 2, &written, nullptr);
    WriteFile(file, &sampleRate, 4, &written, nullptr);
    WriteFile(file, &byteRate, 4, &written, nullptr);
    WriteFile(file, &blockAlign, 2, &written, nullptr);
    WriteFile(file, &bitsPerSample, 2, &written, nullptr);
    WriteFile(file, "data", 4, &written, nullptr);
    WriteFile(file, &dataSize, 4, &written, nullptr);
    return true;
}

void WasapiCapture::writePcmFrames(const int16_t* samples, UINT32 frameCount, WORD channels) {
    if (!samples || frameCount == 0 || channels == 0 || outputFile_ == INVALID_HANDLE_VALUE) {
        return;
    }

    std::vector<int16_t> chunk(samples, samples + static_cast<size_t>(frameCount) * channels);
    const uint32_t fadeFrames = fadeInFramesRemaining_.load();
    if (fadeFrames > 0) {
        const uint32_t totalFadeFrames = boundaryFadeInFrameCount();
        const uint32_t remainingFadeFrames = (std::min)(fadeFrames, totalFadeFrames);
        const uint32_t framesToFade =
            (std::min)(static_cast<uint32_t>(frameCount), remainingFadeFrames);
        const uint32_t completedFadeFrames = totalFadeFrames - remainingFadeFrames;
        for (uint32_t frame = 0; frame < framesToFade; frame++) {
            const double scale =
                static_cast<double>(completedFadeFrames + frame + 1) /
                static_cast<double>(totalFadeFrames);
            for (WORD channel = 0; channel < channels; channel++) {
                const size_t index = static_cast<size_t>(frame) * channels + channel;
                const long scaled = std::lround(static_cast<double>(chunk[index]) * scale);
                chunk[index] = static_cast<int16_t>(std::clamp<long>(scaled, -32768, 32767));
            }
        }
        fadeInFramesRemaining_ = remainingFadeFrames - framesToFade;
    }

    // Count frames as soon as they are queued: the gap detection in the
    // capture loop compares against this and must not wait for the disk.
    totalDataBytes_.fetch_add(static_cast<uint64_t>(chunk.size()) * sizeof(int16_t));
    framesWritten_.fetch_add(frameCount);
    enqueueWrite(std::move(chunk));
}

void WasapiCapture::enqueueWrite(std::vector<int16_t>&& samples) {
    {
        std::lock_guard<std::mutex> lock(writeMutex_);
        writeQueue_.push_back(std::move(samples));
    }
    writeCv_.notify_one();
}

void WasapiCapture::writerThread() {
    std::deque<std::vector<int16_t>> pending;
    for (;;) {
        {
            std::unique_lock<std::mutex> lock(writeMutex_);
            writeCv_.wait(lock, [this] { return writerStop_ || !writeQueue_.empty(); });
            pending.swap(writeQueue_);
            if (pending.empty() && writerStop_) {
                return;
            }
        }
        for (const auto& chunk : pending) {
            const DWORD bytes = static_cast<DWORD>(chunk.size() * sizeof(int16_t));
            DWORD written = 0;
            if (bytes > 0 && WriteFile(outputFile_, chunk.data(), bytes, &written, nullptr)) {
                bytesOnDisk_.fetch_add(written);
            }
        }
        pending.clear();
    }
}

void WasapiCapture::writeSilenceFrames(uint64_t frameCount, WORD channels) {
    if (frameCount == 0 || channels == 0 || outputFile_ == INVALID_HANDLE_VALUE) {
        return;
    }

    gapFillCount_.fetch_add(1);
    insertedSilenceFrames_.fetch_add(frameCount);
    std::vector<int16_t> silence(static_cast<size_t>(kSilenceWriteChunkFrames * channels), 0);
    while (frameCount > 0) {
        const uint64_t chunkFrames = (std::min)(frameCount, kSilenceWriteChunkFrames);
        writePcmFrames(silence.data(), static_cast<UINT32>(chunkFrames), channels);
        frameCount -= chunkFrames;
    }
    fadeInFramesRemaining_ = boundaryFadeInFrameCount();
}

uint64_t WasapiCapture::capturedDurationMs() const {
    if (!mixFormat_ || mixFormat_->nSamplesPerSec == 0) {
        return 0;
    }

    return (framesWritten_.load() * 1000) / mixFormat_->nSamplesPerSec;
}

uint32_t WasapiCapture::sampleRate() const {
    return mixFormat_ ? mixFormat_->nSamplesPerSec : 0;
}

uint16_t WasapiCapture::channelCount() const {
    return mixFormat_ ? mixFormat_->nChannels : 0;
}

uint32_t WasapiCapture::boundaryFadeInFrameCount() const {
    const uint32_t rate = sampleRate();
    if (rate == 0) {
        return 1;
    }
    const uint32_t fadeFrames = (rate * kBoundaryFadeInMs) / 1000;
    return fadeFrames > 0 ? fadeFrames : 1;
}

void WasapiCapture::captureThread() {
    // COM must be initialized on every thread that uses COM objects.
    // The main thread calls winrt::init_apartment(MTA) but that only covers
    // the main thread.  Windows 11 enforces per-thread COM init more strictly
    // than Windows 10, causing silent audio capture failures without this.
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);

    // Run as a real-time audio thread so video encoding or other apps cannot
    // starve it, and use a 1 ms timer so the short polling sleep is accurate.
    DWORD mmcssTaskIndex = 0;
    HANDLE mmcssHandle = AvSetMmThreadCharacteristicsW(L"Pro Audio", &mmcssTaskIndex);
    if (!mmcssHandle) {
        SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_TIME_CRITICAL);
    }
    timeBeginPeriod(1);

    WORD channels = static_cast<WORD>(mixFormat_->nChannels);
    const bool isFloat = isFloatFormat(mixFormat_);
    const bool isPcm = isPcmFormat(mixFormat_);
    const WORD bitsPerSample = mixFormat_->wBitsPerSample;
    const WORD sourceBlockAlign = mixFormat_->nBlockAlign;
    const WORD sourceBytesPerSample =
        channels > 0 ? static_cast<WORD>(sourceBlockAlign / channels) : 0;

    std::vector<int16_t> pcmBuffer;

    const DWORD sleepMs = kPollIntervalMs;

    // Last time a packet arrived (QPC, 100 ns); 0 = not measuring (paused).
    int64_t lastPacketHns = 0;
    bool reportedMutedMic = false;
    int64_t silentSinceHns = 0;

    // Reopen the stream after a failure, retrying until it works or the
    // recording stops. The missing time is filled with silence by the gap
    // logic below, so the audio stays in sync with the video.
    auto recoverStream = [&](HRESULT failure, const char* what) -> bool {
        std::cerr << "WASAPI: " << what << " hr=0x" << std::hex << failure << std::dec
                  << "; reopening the audio device" << std::endl;
        while (capturing_) {
            if (reopenStream()) {
                streamRestartCount_.fetch_add(1);
                lastPacketHns = queryPerformanceCounterHns();
                std::cerr << "WASAPI: audio stream reopened" << std::endl;
                return true;
            }
            Sleep(kReopenRetryMs);
        }
        return false;
    };

    while (capturing_) {
        if (paused_) {
            lastPacketHns = 0;
            Sleep(10);
            continue;
        }

        Sleep(sleepMs);

        const int64_t nowHns = queryPerformanceCounterHns();
        if (lastPacketHns == 0) {
            lastPacketHns = nowHns;
        }

        UINT32 packetLength = 0;
        HRESULT hr = captureClient_ ? captureClient_->GetNextPacketSize(&packetLength) : E_POINTER;
        if (FAILED(hr)) {
            if (!recoverStream(hr, "GetNextPacketSize failed")) break;
            continue;
        }

        if (packetLength == 0) {
            if (
                dataFlow_ == eCapture &&
                nowHns > 0 &&
                nowHns - lastPacketHns > kMicStallTimeoutHns
            ) {
                if (!recoverStream(AUDCLNT_E_SERVICE_NOT_RUNNING, "microphone stopped sending audio")) break;
            }
            continue;
        }
        lastPacketHns = nowHns;

        bool streamFailed = false;
        HRESULT failedHr = S_OK;
        while (packetLength > 0) {
            BYTE* data = nullptr;
            UINT32 numFrames = 0;
            DWORD flags = 0;
            UINT64 devicePosition = 0;
            UINT64 qpcPosition = 0;

            hr = captureClient_->GetBuffer(
                &data,
                &numFrames,
                &flags,
                &devicePosition,
                &qpcPosition);
            if (FAILED(hr)) {
                streamFailed = true;
                failedHr = hr;
                break;
            }

            const bool hasDataDiscontinuity =
                (flags & AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY) != 0;
            if (hasDataDiscontinuity) {
                dataDiscontinuityCount_.fetch_add(1);
            }
            if ((flags & AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR) != 0) {
                timestampErrorCount_.fetch_add(1);
            }
            const bool hasReliableTimestamp =
                numFrames > 0 &&
                qpcPosition > 0 &&
                (flags & AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR) == 0;
            if (hasReliableTimestamp) {
                int64_t expected = -1;
                firstPacketQpcHns_.compare_exchange_strong(
                    expected,
                    static_cast<int64_t>(qpcPosition));

                const int64_t firstPacketQpcHns = firstPacketQpcHns_.load();
                if (
                    firstPacketQpcHns >= 0 &&
                    static_cast<int64_t>(qpcPosition) > firstPacketQpcHns
                ) {
                    const int64_t elapsedHns =
                        static_cast<int64_t>(qpcPosition) - firstPacketQpcHns;
                    const int64_t adjustedElapsedHns =
                        elapsedHns > accumulatedPausedQpcHns_.load()
                            ? elapsedHns - accumulatedPausedQpcHns_.load()
                            : 0;
                    const uint64_t expectedStartFrame =
                        (static_cast<uint64_t>(adjustedElapsedHns) * mixFormat_->nSamplesPerSec +
                         kHundredNanosecondsPerSecond / 2) /
                        kHundredNanosecondsPerSecond;
                    const uint64_t writtenFrames = framesWritten_.load();
                    const uint32_t gapThresholdMs = hasDataDiscontinuity
                        ? kDiscontinuityGapFillThresholdMs
                        : kMinimumGapFillThresholdMs;
                    const uint32_t gapThresholdFrameCount =
                        (mixFormat_->nSamplesPerSec * gapThresholdMs) / 1000;
                    const uint64_t gapThresholdFrames =
                        gapThresholdFrameCount > 0 ? gapThresholdFrameCount : 1;

                    if (expectedStartFrame > writtenFrames) {
                        const uint64_t missingFrames = expectedStartFrame - writtenFrames;
                        if (missingFrames > gapThresholdFrames) {
                            writeSilenceFrames(missingFrames, channels);
                        } else if (hasDataDiscontinuity) {
                            compactedDiscontinuityCount_.fetch_add(1);
                            compactedDiscontinuityFrames_.fetch_add(missingFrames);
                        }
                    }
                }
            }

            UINT32 totalSamples = numFrames * channels;
            const bool isSilentPacket = (flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0;
            if (isSilentPacket) {
                silentPacketFrames_.fetch_add(numFrames);
                if (silentSinceHns == 0) silentSinceHns = nowHns;
                if (
                    dataFlow_ == eCapture && !reportedMutedMic &&
                    nowHns - silentSinceHns > 30000000
                ) {
                    reportedMutedMic = true;
                    std::cerr << "WASAPI: Windows reports the microphone as muted "
                                 "(check the mic's mute switch or Windows privacy settings)"
                              << std::endl;
                }
            } else {
                silentSinceHns = 0;
            }
            const uint32_t silentCompactThresholdFrames =
                (mixFormat_->nSamplesPerSec * kSilentDiscontinuityCompactThresholdMs) / 1000;
            if (
                hasDataDiscontinuity &&
                isSilentPacket &&
                framesWritten_.load() > 0 &&
                numFrames > 0 &&
                numFrames <= (silentCompactThresholdFrames > 0 ? silentCompactThresholdFrames : 1)
            ) {
                compactedSilentDiscontinuityCount_.fetch_add(1);
                compactedSilentDiscontinuityFrames_.fetch_add(numFrames);
                captureClient_->ReleaseBuffer(numFrames);
                hr = captureClient_->GetNextPacketSize(&packetLength);
                if (FAILED(hr)) {
                    streamFailed = true;
                    failedHr = hr;
                    break;
                }
                continue;
            }

            if (isSilentPacket) {
                pcmBuffer.assign(totalSamples, 0);
            } else if (isFloat && bitsPerSample == 32 && sourceBytesPerSample >= 4) {
                pcmBuffer.resize(totalSamples);
                const float* src = reinterpret_cast<const float*>(data);
                for (UINT32 i = 0; i < totalSamples; i++) {
                    pcmBuffer[i] = floatToInt16(src[i]);
                }
            } else if (isPcm && bitsPerSample == 16 && sourceBytesPerSample >= 2) {
                pcmBuffer.resize(totalSamples);
                if (sourceBytesPerSample == sizeof(int16_t)) {
                    std::memcpy(pcmBuffer.data(), data, totalSamples * sizeof(int16_t));
                } else {
                    for (UINT32 frame = 0; frame < numFrames; frame++) {
                        const BYTE* frameData = data + frame * sourceBlockAlign;
                        for (WORD channel = 0; channel < channels; channel++) {
                            const BYTE* sample = frameData + channel * sourceBytesPerSample;
                            pcmBuffer[frame * channels + channel] =
                                *reinterpret_cast<const int16_t*>(sample);
                        }
                    }
                }
            } else if (isPcm && bitsPerSample == 24 && sourceBytesPerSample >= 3) {
                pcmBuffer.resize(totalSamples);
                for (UINT32 frame = 0; frame < numFrames; frame++) {
                    const BYTE* frameData = data + frame * sourceBlockAlign;
                    for (WORD channel = 0; channel < channels; channel++) {
                        const BYTE* sample = frameData + channel * sourceBytesPerSample;
                        pcmBuffer[frame * channels + channel] = pcm24ToInt16(sample);
                    }
                }
            } else if (isPcm && bitsPerSample == 32 && sourceBytesPerSample >= 4) {
                pcmBuffer.resize(totalSamples);
                for (UINT32 frame = 0; frame < numFrames; frame++) {
                    const BYTE* frameData = data + frame * sourceBlockAlign;
                    for (WORD channel = 0; channel < channels; channel++) {
                        const BYTE* sample = frameData + channel * sourceBytesPerSample;
                        const int32_t value = *reinterpret_cast<const int32_t*>(sample);
                        pcmBuffer[frame * channels + channel] = static_cast<int16_t>(value >> 16);
                    }
                }
            } else if (isPcm && bitsPerSample == 8 && sourceBytesPerSample >= 1) {
                pcmBuffer.resize(totalSamples);
                for (UINT32 frame = 0; frame < numFrames; frame++) {
                    const BYTE* frameData = data + frame * sourceBlockAlign;
                    for (WORD channel = 0; channel < channels; channel++) {
                        const BYTE value = *(frameData + channel * sourceBytesPerSample);
                        pcmBuffer[frame * channels + channel] =
                            static_cast<int16_t>((static_cast<int>(value) - 128) << 8);
                    }
                }
            } else {
                pcmBuffer.assign(totalSamples, 0);
            }

            captureClient_->ReleaseBuffer(numFrames);

            writePcmFrames(pcmBuffer.data(), numFrames, channels);

            hr = captureClient_->GetNextPacketSize(&packetLength);
            if (FAILED(hr)) {
                streamFailed = true;
                failedHr = hr;
                break;
            }
        }

        if (streamFailed && !recoverStream(failedHr, "reading audio failed")) {
            break;
        }
    }

    timeEndPeriod(1);
    if (mmcssHandle) {
        AvRevertMmThreadCharacteristics(mmcssHandle);
    }
    CoUninitialize();
}
