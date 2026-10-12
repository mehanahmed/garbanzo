# CamVerse server setup (Sign in, Feedback, Share link, Shared)

এই চারটা feature-এর জন্য CamVerse-এর নিজের দুটো server লাগে:

| Server | কাজ | খরচ |
|---|---|---|
| **Supabase** | Sign in / account, Feedback, export error report | Free plan |
| **Cloudflare** (Worker + R2 + D1) | Publish → **Link**, ভিডিও দেখার page, **Shared** library | Free plan (R2-এ ১০ GB পর্যন্ত free) |

Server বসানোর কাজ GitHub নিজেই করবে ("Deploy CamVerse services" workflow)। আপনার কাজ শুধু দুটো account খোলা আর কয়েকটা key GitHub-এ রাখা। **কোনো key chat-এ বা কাউকে পাঠাবেন না**, শুধু GitHub Settings-এ বসাবেন।

সময় লাগবে প্রায় ২০–৩০ মিনিট।

---

## ধাপ ১: Supabase (Sign in আর Feedback)

1. **https://supabase.com** → **Start your project** → GitHub বা email দিয়ে sign up করুন।
2. **New project** চাপুন:
   - **Name:** `CamVerse`
   - **Database Password:** একটা শক্ত password দিন আর **কোথাও লিখে রাখুন** (পরে লাগবে)।
   - **Region:** `South Asia (Mumbai)`। বাংলাদেশের সবচেয়ে কাছের region।
   - **Create new project** চাপুন। তৈরি হতে ১–২ মিনিট লাগে।
3. **Project ref** কপি করুন: browser-এর ঠিকানায় `supabase.com/dashboard/project/`-এর পরের ২০ অক্ষরের লেখাটা, যেমন `abcdefghijklmnopqrst`।
4. **Access token** বানান: উপরে ডানে আপনার ছবি → **Account preferences** → **Access Tokens** → **Generate new token** → নাম দিন `camverse-deploy` → token-টা কপি করুন (একবারই দেখায়)।

## ধাপ ২: Cloudflare (Share link আর Shared)

1. **https://dash.cloudflare.com/sign-up** থেকে free account খুলুন, email verify করুন।
2. বাম মেনু থেকে **Workers & Pages** একবার খুলুন। প্রথমবার এটা একটা **workers.dev subdomain** বাছতে বলবে (যেমন `colorhut`)। বেছে নিন।
3. বাম মেনু → **R2 Object Storage** → **Enable / Purchase R2**। Card চাইবে, কিন্তু ১০ GB পর্যন্ত টাকা কাটে না। Share করা ভিডিও ১৪ দিন পর নিজে থেকে মুছে যায়, তাই সাধারণত free সীমার মধ্যেই থাকবে।
4. **Account ID** কপি করুন: **Workers & Pages** পেজের ডান পাশে "Account ID" লেখা আছে।
5. **API token** বানান:
   - উপরে ডানে প্রোফাইল → **My Profile** → **API Tokens** → **Create Token**
   - **Edit Cloudflare Workers** template-এর পাশে **Use template**
   - **Permissions**-এ আরও দুটো লাইন যোগ করুন (**+ Add more**):
     - `Account` → `D1` → `Edit`
     - `Account` → `Workers R2 Storage` → `Edit`
   - **Account Resources:** আপনার account বেছে নিন
   - **Zone Resources:** `All zones` রাখতে পারেন
   - **Continue to summary** → **Create Token** → token কপি করুন

## ধাপ ৩: Key-গুলো GitHub-এ রাখা

GitHub-এ repo খুলুন: **princeshiamofficial/garbanzo** → **Settings** → বাম মেনু **Secrets and variables** → **Actions**।

**Secrets** tab → **New repository secret**। এই চারটা যোগ করুন (নাম হুবহু এমন হতে হবে):

| Name | Value |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | ধাপ ১.৪-এর token |
| `SUPABASE_DB_PASSWORD` | ধাপ ১.২-এর database password |
| `CLOUDFLARE_API_TOKEN` | ধাপ ২.৫-এর token |
| `CLOUDFLARE_ACCOUNT_ID` | ধাপ ২.৪-এর Account ID |

**Variables** tab → **New repository variable**:

| Name | Value |
|---|---|
| `SUPABASE_PROJECT_REF` | ধাপ ১.৩-এর ২০ অক্ষরের project ref |

## ধাপ ৪: Deploy চালানো

1. Repo-তে **Actions** tab → বাম পাশে **Deploy CamVerse services** → **Run workflow** → **Run workflow**।
2. ৫–৮ মিনিটে server চালু হয়ে যাবে। শেষ হলে নিজে থেকেই **Build Electron App** শুরু হবে (আরও ১৫–২০ মিনিট)।
3. Build শেষ হলে নতুন installer আগের link-এই পাওয়া যাবে: https://github.com/princeshiamofficial/garbanzo/releases/latest। আগের CamVerse install থাকলে app নিজেই update নিতে চাইবে।

কোনো ধাপ লাল হয়ে fail করলে সেই ধাপে ক্লিক করুন। লেখাটা পড়লেই সাধারণত বোঝা যায় কী বাকি (যেমন কোন secret নেই)। ছবি পাঠালে আমি ঠিক করে দেব।

## ধাপ ৫: পরীক্ষা

1. নতুন CamVerse খুলুন → **Sign in** → email দিন → email-এ আসা link-এ ক্লিক করুন (একই কম্পিউটারে)। Link CamVerse-এ ফিরে আসবে।
2. একটা project খুলে **Publish** → **Link** → **Create share link**। তৈরি হওয়া link browser-এ খুলে দেখুন ভিডিও চলছে কিনা।
3. **Feedback** থেকে একটা পরীক্ষামূলক বার্তা পাঠান।

---

## জেনে রাখুন

- **Email-এর সীমা:** Supabase-এর নিজস্ব email ঘণ্টায় মাত্র কয়েকটা পাঠাতে পারে। কয়েকজনের বেশি user হলে free SMTP যোগ করুন (যেমন **Resend**, মাসে ৩,০০০ email free): Supabase → **Authentication** → **Emails** → **SMTP Settings**।
- **Share-এর সীমা:** প্রতিটি account-এ একসাথে ৫টা ভিডিও, প্রতিটি সর্বোচ্চ ১ GB, ১৪ দিন পর নিজে থেকে মুছে যায়।
- **Feedback কোথায় দেখবেন:** Supabase → **Table Editor** → `feedback_reports`। সংযুক্ত ফাইল থাকে **Storage** → `feedback-attachments`-এ।
- **Google দিয়ে Sign in (ঐচ্ছিক):** Supabase → **Authentication** → **Sign In / Providers** → Google চালু করে Google-এর client ID/secret দিন। তারপর GitHub-এ variable `CAMVERSE_AUTH_SOCIAL_PROVIDERS` = `google` যোগ করে আবার **Deploy CamVerse services** চালান। (Microsoft হলে `azure`, GitHub হলে `github`, একাধিক হলে কমা দিয়ে।)
- **গোপনীয়তা:** এখন user-দের email আর share করা ভিডিও আপনার server-এ থাকবে। Client-দের জন্য ছোট একটা privacy policy রাখা ভালো।
- **Key বদলালে বা server নতুন করে বসাতে চাইলে** শুধু **Deploy CamVerse services** আবার চালান। এটা যতবার খুশি চালানো যায়, আগের ডেটা মোছে না।

## কারিগরি তথ্য

- Workflow: `.github/workflows/deploy-services.yml`
- Supabase: `services/supabase/` (migrations, `submit-feedback` আর `submit-export-error` function, email template)
- Share server: `services/recordly-share/worker/` (`wrangler.camverse.jsonc`, multi-user "hosted" mode)
- Deploy-এর পর server-এর ঠিকানা `services/camverse-endpoints.json`-এ save হয়, আর প্রতিটি app build সেখান থেকে পড়ে (`scripts/load-camverse-endpoints.mjs`)। শুধু public মান থাকে, কোনো secret থাকে না।
- Share server-টা MIT license-এর Voom project থেকে নেওয়া, তার notice `services/recordly-share/LICENSE`-এ রাখা আছে।
