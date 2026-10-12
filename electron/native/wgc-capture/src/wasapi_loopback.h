#pragma once

#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <string>
#include <thread>
#include <atomic>
#include <condition_variable>
#include <deque>
#include <mutex>
#include <vector>

class WasapiCapture {
public:
    WasapiCapture();
    ~WasapiCapture();

    bool initializeLoopback(const std::string& outputPath);
    bool initializeMic(
        const std::string& outputPath,
        const std::string& deviceId = "",
        const std::string& deviceName = "");
    bool start();
    bool pause();
    bool resume();
    void stop();
    int64_t firstPacketQpcHns() const { return firstPacketQpcHns_.load(); }
    uint64_t capturedDurationMs() const;
    uint64_t totalDataBytes() const { return totalDataBytes_.load(); }
    uint32_t sampleRate() const;
    uint16_t channelCount() const;
    uint32_t dataDiscontinuityCount() const { return dataDiscontinuityCount_.load(); }
    uint32_t timestampErrorCount() const { return timestampErrorCount_.load(); }
    uint32_t gapFillCount() const { return gapFillCount_.load(); }
    uint64_t insertedSilenceFrames() const { return insertedSilenceFrames_.load(); }
    uint32_t compactedDiscontinuityCount() const { return compactedDiscontinuityCount_.load(); }
    uint64_t compactedDiscontinuityFrames() const { return compactedDiscontinuityFrames_.load(); }
    uint32_t compactedSilentDiscontinuityCount() const { return compactedSilentDiscontinuityCount_.load(); }
    uint64_t compactedSilentDiscontinuityFrames() const { return compactedSilentDiscontinuityFrames_.load(); }
    uint32_t streamRestartCount() const { return streamRestartCount_.load(); }
    uint64_t silentPacketFrames() const { return silentPacketFrames_.load(); }

private:
    bool initializeCommon();
    // Reopens the audio stream after Windows invalidated or stalled it (device
    // unplugged/re-plugged, default device changed, driver reset, another app
    // reconfiguring the device). Keeps the file's sample format.
    bool reopenStream();
    void rememberDeviceId();
    void captureThread();
    void writerThread();
    void enqueueWrite(std::vector<int16_t>&& samples);
    bool writeWavHeader(HANDLE file, DWORD dataSize);
    void writePcmFrames(const int16_t* samples, UINT32 frameCount, WORD channels);
    void writeSilenceFrames(uint64_t frameCount, WORD channels);
    uint32_t boundaryFadeInFrameCount() const;
    IMMDevice* findCaptureDeviceByName(const std::wstring& name);

    std::string outputPath_;
    std::thread thread_;
    // Disk writes run on their own thread so a slow disk can never stall the
    // capture loop (a stalled loop loses audio and sounds "broken").
    std::thread writer_;
    std::mutex writeMutex_;
    std::condition_variable writeCv_;
    std::deque<std::vector<int16_t>> writeQueue_;
    bool writerStop_ = false;
    std::atomic<uint64_t> bytesOnDisk_{0};
    std::atomic<bool> capturing_{false};
    std::atomic<bool> paused_{false};
    HANDLE outputFile_ = INVALID_HANDLE_VALUE;
    std::atomic<uint64_t> totalDataBytes_{0};
    std::atomic<uint64_t> framesWritten_{0};

    IMMDeviceEnumerator* enumerator_ = nullptr;
    IMMDevice* device_ = nullptr;
    IAudioClient* audioClient_ = nullptr;
    IAudioCaptureClient* captureClient_ = nullptr;
    WAVEFORMATEX* mixFormat_ = nullptr;
    DWORD streamFlags_ = 0;
    EDataFlow dataFlow_ = eCapture;
    ERole defaultRole_ = eConsole;
    // True when the user picked "Default"/"Communications" (or for system
    // audio): after a failure, reopen whatever device Windows now uses.
    bool followDefaultDevice_ = false;
    std::wstring deviceIdString_;
    // Guards audioClient_ between the capture thread (reopen) and
    // pause/resume/stop on the main thread.
    std::mutex clientMutex_;
    std::atomic<uint32_t> streamRestartCount_{0};
    std::atomic<uint64_t> silentPacketFrames_{0};

    UINT32 bufferFrameCount_ = 0;
    std::atomic<int64_t> firstPacketQpcHns_{-1};
    std::atomic<int64_t> pauseStartQpcHns_{0};
    std::atomic<int64_t> accumulatedPausedQpcHns_{0};
    std::atomic<uint32_t> dataDiscontinuityCount_{0};
    std::atomic<uint32_t> timestampErrorCount_{0};
    std::atomic<uint32_t> gapFillCount_{0};
    std::atomic<uint64_t> insertedSilenceFrames_{0};
    std::atomic<uint32_t> compactedDiscontinuityCount_{0};
    std::atomic<uint64_t> compactedDiscontinuityFrames_{0};
    std::atomic<uint32_t> compactedSilentDiscontinuityCount_{0};
    std::atomic<uint64_t> compactedSilentDiscontinuityFrames_{0};
    std::atomic<uint32_t> fadeInFramesRemaining_{0};
};
