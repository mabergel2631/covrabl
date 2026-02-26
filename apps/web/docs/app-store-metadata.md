# Covrabl — App Store Submission Metadata

## General

- **App Name**: Covrabl
- **Subtitle**: Know What You're Covered For
- **Bundle ID / Package**: com.covrabl.app
- **Primary Category**: Finance
- **Secondary Category**: Productivity

---

## Apple App Store

### Description

Upload your insurance policies and instantly see what's covered, where you have gaps, and what's coming up for renewal.

Covrabl uses AI-powered coverage analysis to score your protection, detect gaps, track renewals, and explain policy changes — so you always know where you stand.

Features:
- Upload any insurance document (auto, home, health, life, business)
- AI-powered coverage scoring and gap detection
- Renewal tracking with smart alerts
- Emergency access card (ICE) with offline support
- Policy comparison across providers
- Certificate of insurance management
- Agent collaboration portal
- Chat-based policy insights powered by AI

### Keywords

insurance, policy, coverage, renewal, gap analysis, insurance tracker, policy management, coverage score, certificate, emergency card

### URLs

- Privacy: https://covrabl.com/privacy
- Support: https://covrabl.com/support
- Marketing: https://covrabl.com

### Content Rating

- Age Rating: 4+
- No objectionable content, gambling, violence, or mature themes
- Financial data (insurance) — not medical advice

### Privacy Nutrition Labels

**Data Used to Track You**: None

**Data Linked to You**:
- Email Address — account sign-in
- Name — user profile
- Phone Number — emergency contacts (ICE card)
- Other User Content — insurance documents and policy data

**Data Not Collected**: Location, browsing history, search history, diagnostics, financial payment info (Stripe handles this)

### Review Notes

```
Test account:
  Email: review@covrabl.com
  Password: [CREATE BEFORE SUBMISSION]

The app requires an internet connection. It loads content from covrabl.com
using native Capacitor plugins for enhanced mobile experience including
haptic feedback, native status bar integration, camera-based document
capture, and splash screen.

To test core features:
1. Log in with the test account
2. View uploaded policies on the Policies page
3. Tap a policy to see coverage scoring and gap analysis
4. Use Policy Insights (chat) to ask questions about coverage
5. View the Emergency (ICE) card
6. Check Renewals for upcoming renewal alerts
```

### Screenshot Sizes Required

- 6.7" iPhone (iPhone 15 Pro Max): 1290 x 2796
- 6.5" iPhone (iPhone 14 Plus): 1284 x 2778
- 5.5" iPhone (iPhone 8 Plus): 1242 x 2208
- 12.9" iPad Pro: 2048 x 2732

---

## Google Play Store

### Short Description (80 chars max)

Upload insurance policies. See coverage scores, gaps, renewals, and insights.

### Full Description (4000 chars max)

Covrabl is the easiest way to organize, understand, and stay on top of your insurance.

Upload your insurance documents — auto, home, health, life, renters, business — and Covrabl does the rest. Our AI reads your policies and gives you a clear picture of what you're covered for, where you have gaps, and when renewals are coming up.

KEY FEATURES

Coverage Scoring
Every policy gets a coverage score so you can see at a glance how well you're protected. Covrabl analyzes nine categories and highlights areas where you may be underinsured.

Gap Detection
Covrabl automatically identifies gaps in your coverage — like missing umbrella policies, low liability limits, or inadequate deductibles — and suggests what to consider.

Policy Insights (AI Chat)
Ask questions about your coverage in plain English. "Am I covered if a tree falls on my car?" — and get answers based on your actual policy documents.

Renewal Tracking
Never miss a renewal. Covrabl tracks every renewal date across all your policies and alerts you before they're due.

Change Detection
When you upload updated policies, Covrabl detects what changed — premium increases, coverage modifications, new exclusions — and explains them clearly.

Emergency Access (ICE Card)
Create a digital emergency card with your critical policy information and emergency contacts. Share it with family members so they know what to do if something happens.

Certificate Management
Store and organize your certificates of insurance (COIs) in one place.

Agent Collaboration
Share your policy vault with your insurance agent or financial advisor for better coordination.

PRIVACY FIRST
- We never sell your data
- No advertising or tracking
- Your documents are encrypted in transit
- Delete your account and all data at any time

Download Covrabl and finally know what you're covered for.

### Category

Finance

### Content Rating (IARC Questionnaire)

- Violence: No
- Sexual content: No
- Language: No
- Controlled substance: No
- User interaction: Limited (agent sharing)
- Shares location: No
- Financial transactions: Yes (subscription via payment processor)
- Expected rating: Everyone

### Data Safety Form Answers

**Data collected:**
| Data type | Collected | Shared | Purpose |
|-----------|-----------|--------|---------|
| Email address | Yes | No | Account management |
| Name | Yes | No | App functionality |
| Phone number | Yes | No | App functionality (emergency contacts) |
| Files (insurance docs) | Yes | No | App functionality |
| App interactions | Yes | No | Analytics (Plausible, cookie-free) |

**Security practices:**
- Data encrypted in transit: Yes
- Users can request data deletion: Yes
- Data deletion process: In-app (Profile > Danger Zone) or email support@covrabl.com

### Assets Required

- Feature graphic: 1024 x 500 PNG (marketing banner)
- App icon: 512 x 512 PNG (already generated at public/icons/icon-512-android.png)
- Screenshots: Phone (16:9), 7" tablet, 10" tablet

### Account Type

Organization account (required for Finance category apps on Google Play)

---

## Pre-Submission Checklist

### Both Stores
- [ ] Create test account: review@covrabl.com with 3-4 sample policies
- [ ] Upload sample insurance documents to test account
- [ ] Generate ICE emergency card for test account
- [ ] Verify account deletion works end-to-end
- [ ] Verify all links work (privacy, support, terms)
- [ ] Take screenshots on required device sizes
- [ ] Test app launch, login, core flows for crashes

### Apple Specific
- [ ] Apple Developer account enrolled ($99/year)
- [ ] App Store Connect listing created
- [ ] Privacy nutrition labels filled out
- [ ] Build and sign with Xcode (requires Mac)
- [ ] Upload to TestFlight for internal testing
- [ ] Submit for review

### Google Play Specific
- [ ] Google Play Developer account enrolled ($25 one-time)
- [ ] Play Console listing created
- [ ] Data Safety form completed
- [ ] IARC content rating questionnaire completed
- [ ] Feature graphic (1024x500) designed and uploaded
- [ ] Build signed AAB with Android Studio
- [ ] Internal testing track upload
- [ ] Submit for review
