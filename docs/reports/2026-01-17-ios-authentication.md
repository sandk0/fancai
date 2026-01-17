# iOS Authentication Methods Research for fancai

**Date:** 2026-01-17
**Scope:** Authentication methods for iOS app (book reader with AI)
**Author:** Claude Code

## Executive Summary

This report provides a comprehensive analysis of authentication methods for the fancai iOS application. The research covers Sign in with Apple (mandatory for App Store), Google Sign-In, Telegram authentication alternatives, traditional email/password flow, JWT integration with the existing backend, and biometric authentication. Recommendations are provided for implementing a secure, user-friendly authentication system that integrates with the existing FastAPI backend.

---

## Table of Contents

1. [Sign in with Apple](#1-sign-in-with-apple)
2. [Sign in with Google](#2-sign-in-with-google)
3. [Telegram Login](#3-telegram-login)
4. [Email + Password](#4-email--password)
5. [JWT Integration with Backend](#5-jwt-integration-with-backend)
6. [Biometric Authentication](#6-biometric-authentication)
7. [Comparison Table](#7-comparison-table)
8. [Recommendations for fancai](#8-recommendations-for-fancai)
9. [Sources](#9-sources)

---

## 1. Sign in with Apple

### 1.1 App Store Requirements

**When Sign in with Apple is Mandatory:**

| Scenario | Required? |
|----------|-----------|
| App uses third-party social login (Google, Facebook, etc.) | **Yes** |
| App uses only company's own account system | No |
| Education/enterprise app with existing accounts | No |
| Client for specific third-party service | No |
| Government/industry-backed ID system | No |

> **Important:** If fancai implements Google Sign-In or any other third-party authentication, Sign in with Apple becomes **mandatory** for App Store approval.

**2026 Update:** For apps using Sign in with Apple in South Korea, a server-to-server notification endpoint must be registered by January 1, 2026.

### 1.2 Prerequisites

1. Apple Developer Program membership (active)
2. Add "Sign In with Apple" capability in Xcode:
   - Project Settings > Signing & Capabilities > + Capability > Sign in with Apple
3. Configure App ID in Apple Developer Portal
4. Create Service ID for backend verification

### 1.3 SwiftUI Implementation

```swift
import SwiftUI
import AuthenticationServices

struct AppleSignInView: View {
    @StateObject private var viewModel = AppleSignInViewModel()

    var body: some View {
        SignInWithAppleButton(.signIn) { request in
            request.requestedScopes = [.fullName, .email]
            request.nonce = viewModel.generateNonce()
        } onCompletion: { result in
            viewModel.handleSignInResult(result)
        }
        .signInWithAppleButtonStyle(.black) // .white, .whiteOutline
        .frame(height: 50)
        .cornerRadius(8)
    }
}

class AppleSignInViewModel: ObservableObject {
    @Published var isAuthenticated = false
    @Published var errorMessage: String?

    private var currentNonce: String?

    func generateNonce() -> String {
        // Generate random nonce for security
        let nonce = randomNonceString()
        currentNonce = sha256(nonce)
        return nonce
    }

    func handleSignInResult(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .success(let authorization):
            handleAuthorization(authorization)
        case .failure(let error):
            errorMessage = error.localizedDescription
        }
    }

    private func handleAuthorization(_ authorization: ASAuthorization) {
        guard let appleIDCredential = authorization.credential as? ASAppleIDCredential else {
            errorMessage = "Invalid credential type"
            return
        }

        // IMPORTANT: Apple only sends name and email on FIRST sign-in
        let userIdentifier = appleIDCredential.user
        let fullName = appleIDCredential.fullName
        let email = appleIDCredential.email

        // Identity token for backend verification
        guard let identityTokenData = appleIDCredential.identityToken,
              let identityToken = String(data: identityTokenData, encoding: .utf8) else {
            errorMessage = "Missing identity token"
            return
        }

        // Authorization code for backend token exchange
        guard let authorizationCodeData = appleIDCredential.authorizationCode,
              let authorizationCode = String(data: authorizationCodeData, encoding: .utf8) else {
            errorMessage = "Missing authorization code"
            return
        }

        // Send to backend for verification
        Task {
            await sendToBackend(
                userIdentifier: userIdentifier,
                identityToken: identityToken,
                authorizationCode: authorizationCode,
                fullName: fullName,
                email: email,
                nonce: currentNonce
            )
        }
    }

    private func sendToBackend(
        userIdentifier: String,
        identityToken: String,
        authorizationCode: String,
        fullName: PersonNameComponents?,
        email: String?,
        nonce: String?
    ) async {
        // POST to /api/v1/auth/apple
        let body: [String: Any] = [
            "user_identifier": userIdentifier,
            "identity_token": identityToken,
            "authorization_code": authorizationCode,
            "full_name": fullName?.formatted() ?? "",
            "email": email ?? "",
            "nonce": nonce ?? ""
        ]

        // Make API request to fancai backend
        // Backend should verify identity_token and return JWT tokens
    }

    // Check credential state on app launch
    func checkCredentialState(userIdentifier: String) {
        let provider = ASAuthorizationAppleIDProvider()
        provider.getCredentialState(forUserID: userIdentifier) { state, error in
            DispatchQueue.main.async {
                switch state {
                case .authorized:
                    self.isAuthenticated = true
                case .revoked, .notFound:
                    self.isAuthenticated = false
                    // User revoked access or account not found
                    // Clear local credentials
                @unknown default:
                    break
                }
            }
        }
    }
}

// MARK: - Nonce Generation Helpers

func randomNonceString(length: Int = 32) -> String {
    let charset: [Character] = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
    var result = ""
    var remainingLength = length

    while remainingLength > 0 {
        let randoms: [UInt8] = (0 ..< 16).map { _ in
            var random: UInt8 = 0
            let errorCode = SecRandomCopyBytes(kSecRandomDefault, 1, &random)
            if errorCode != errSecSuccess {
                fatalError("Unable to generate nonce")
            }
            return random
        }

        randoms.forEach { random in
            if remainingLength == 0 { return }
            if random < charset.count {
                result.append(charset[Int(random)])
                remainingLength -= 1
            }
        }
    }
    return result
}

func sha256(_ input: String) -> String {
    import CryptoKit
    let inputData = Data(input.utf8)
    let hashedData = SHA256.hash(data: inputData)
    return hashedData.compactMap { String(format: "%02x", $0) }.joined()
}
```

### 1.4 Privacy Considerations

| Aspect | Details |
|--------|---------|
| Email disclosure | User can choose "Hide My Email" (generates random @privaterelay.appleid.com) |
| Name disclosure | User can modify or decline to share |
| Data sent only once | Apple sends email/name **only on first sign-in**; subsequent logins return only `user` identifier |
| Token validation | Always verify `identityToken` on backend |

**Best Practices:**
- Store user identifier (`user`) locally after first successful sign-in
- Store email and name immediately on first sign-in (won't be sent again)
- Implement credential state checking on app launch
- Support token revocation handling via server-to-server notifications

### 1.5 Backend Verification (Python/FastAPI)

```python
# backend/app/services/apple_auth.py
import jwt
import httpx
from typing import Optional
from datetime import datetime

APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys"
APPLE_ISSUER = "https://appleid.apple.com"

class AppleAuthService:
    def __init__(self, bundle_id: str):
        self.bundle_id = bundle_id
        self._apple_keys = None
        self._keys_fetched_at = None

    async def get_apple_public_keys(self) -> dict:
        """Fetch Apple's public keys for JWT verification."""
        # Cache keys for 24 hours
        if self._apple_keys and self._keys_fetched_at:
            if (datetime.utcnow() - self._keys_fetched_at).seconds < 86400:
                return self._apple_keys

        async with httpx.AsyncClient() as client:
            response = await client.get(APPLE_KEYS_URL)
            self._apple_keys = response.json()
            self._keys_fetched_at = datetime.utcnow()
            return self._apple_keys

    async def verify_identity_token(
        self,
        identity_token: str,
        nonce: Optional[str] = None
    ) -> Optional[dict]:
        """
        Verify Apple identity token and extract user data.

        Returns decoded payload if valid, None otherwise.
        """
        try:
            # Get header to find key ID
            header = jwt.get_unverified_header(identity_token)
            kid = header.get("kid")

            # Get Apple's public keys
            keys = await self.get_apple_public_keys()

            # Find matching key
            apple_key = None
            for key in keys.get("keys", []):
                if key.get("kid") == kid:
                    apple_key = key
                    break

            if not apple_key:
                return None

            # Construct public key and verify
            public_key = jwt.algorithms.RSAAlgorithm.from_jwk(apple_key)

            payload = jwt.decode(
                identity_token,
                public_key,
                algorithms=["RS256"],
                audience=self.bundle_id,
                issuer=APPLE_ISSUER
            )

            # Verify nonce if provided
            if nonce and payload.get("nonce") != nonce:
                return None

            return payload

        except jwt.ExpiredSignatureError:
            return None
        except jwt.InvalidTokenError:
            return None

apple_auth_service = AppleAuthService(bundle_id="com.fancai.reader")
```

---

## 2. Sign in with Google

### 2.1 Setup Requirements

1. Create project in [Google Cloud Console](https://console.cloud.google.com/)
2. Configure OAuth consent screen
3. Create OAuth 2.0 Client ID (iOS type)
4. Add to Xcode project via Swift Package Manager:
   ```
   https://github.com/google/GoogleSignIn-iOS
   ```

### 2.2 Info.plist Configuration

```xml
<!-- Info.plist -->
<key>GIDClientID</key>
<string>YOUR_IOS_CLIENT_ID.apps.googleusercontent.com</string>

<key>CFBundleURLTypes</key>
<array>
    <dict>
        <key>CFBundleURLSchemes</key>
        <array>
            <!-- Reversed client ID -->
            <string>com.googleusercontent.apps.YOUR_IOS_CLIENT_ID</string>
        </array>
    </dict>
</array>
```

### 2.3 SwiftUI Implementation

```swift
import SwiftUI
import GoogleSignIn
import GoogleSignInSwift

struct GoogleSignInView: View {
    @StateObject private var viewModel = GoogleSignInViewModel()

    var body: some View {
        VStack(spacing: 16) {
            // Native Google Sign-In Button
            GoogleSignInButton(
                viewModel: GoogleSignInButtonViewModel(
                    scheme: .dark,
                    style: .wide,
                    state: .normal
                )
            ) {
                viewModel.signIn()
            }
            .frame(height: 50)

            // Or custom button
            Button(action: viewModel.signIn) {
                HStack {
                    Image("google_logo")
                        .resizable()
                        .frame(width: 24, height: 24)
                    Text("Sign in with Google")
                        .font(.system(size: 16, weight: .medium))
                }
                .foregroundColor(.black)
                .frame(maxWidth: .infinity)
                .frame(height: 50)
                .background(Color.white)
                .cornerRadius(8)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.gray.opacity(0.3), lineWidth: 1)
                )
            }
        }
    }
}

class GoogleSignInViewModel: ObservableObject {
    @Published var isAuthenticated = false
    @Published var user: GIDGoogleUser?
    @Published var errorMessage: String?

    func signIn() {
        guard let presentingVC = getRootViewController() else {
            errorMessage = "Unable to get presenting view controller"
            return
        }

        // Configure scopes (default: profile, email)
        let signInConfig = GIDConfiguration(clientID: "YOUR_CLIENT_ID.apps.googleusercontent.com")

        GIDSignIn.sharedInstance.configuration = signInConfig

        GIDSignIn.sharedInstance.signIn(withPresenting: presentingVC) { [weak self] result, error in
            if let error = error {
                self?.errorMessage = error.localizedDescription
                return
            }

            guard let user = result?.user else {
                self?.errorMessage = "No user returned"
                return
            }

            self?.user = user
            self?.handleSuccessfulSignIn(user: user)
        }
    }

    private func handleSuccessfulSignIn(user: GIDGoogleUser) {
        // Get ID token for backend verification
        guard let idToken = user.idToken?.tokenString else {
            errorMessage = "Missing ID token"
            return
        }

        let profile = user.profile
        let email = profile?.email ?? ""
        let fullName = profile?.name ?? ""
        let profileImageURL = profile?.imageURL(withDimension: 200)?.absoluteString ?? ""

        // Send to backend
        Task {
            await sendToBackend(
                idToken: idToken,
                email: email,
                fullName: fullName,
                profileImageURL: profileImageURL
            )
        }
    }

    private func sendToBackend(
        idToken: String,
        email: String,
        fullName: String,
        profileImageURL: String
    ) async {
        // POST to /api/v1/auth/google
        let body: [String: Any] = [
            "id_token": idToken,
            "email": email,
            "full_name": fullName,
            "profile_image_url": profileImageURL
        ]

        // Make API request to fancai backend
        // Backend verifies id_token with Google and returns JWT tokens
    }

    // Restore previous sign-in on app launch
    func restorePreviousSignIn() {
        GIDSignIn.sharedInstance.restorePreviousSignIn { [weak self] user, error in
            if let user = user {
                self?.user = user
                self?.isAuthenticated = true
            }
        }
    }

    func signOut() {
        GIDSignIn.sharedInstance.signOut()
        user = nil
        isAuthenticated = false
    }

    private func getRootViewController() -> UIViewController? {
        guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let window = windowScene.windows.first else {
            return nil
        }
        return window.rootViewController
    }
}
```

### 2.4 OAuth 2.0 Scopes

| Scope | Description | When to Use |
|-------|-------------|-------------|
| `openid` | OpenID Connect (identity) | Always (default) |
| `profile` | Name, profile picture | User display |
| `email` | Email address | Account creation |
| `https://www.googleapis.com/auth/books` | Google Books API | If integrating with Google Books |

### 2.5 App Delegate Configuration

```swift
import SwiftUI
import GoogleSignIn

@main
struct FancaiApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
                .onOpenURL { url in
                    GIDSignIn.sharedInstance.handle(url)
                }
        }
    }
}

class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        // Restore previous sign-in
        GIDSignIn.sharedInstance.restorePreviousSignIn { user, error in
            if let user = user {
                // User is signed in
            }
        }
        return true
    }

    func application(
        _ app: UIApplication,
        open url: URL,
        options: [UIApplication.OpenURLOptionsKey: Any] = [:]
    ) -> Bool {
        return GIDSignIn.sharedInstance.handle(url)
    }
}
```

---

## 3. Telegram Login

### 3.1 Options Comparison

| Method | Use Case | Complexity | Best For |
|--------|----------|------------|----------|
| **TDLib** | Full Telegram client | High | Telegram-like apps |
| **TDLibKit** | Swift wrapper for TDLib | Medium | Native iOS integration |
| **Bot API + Deep Links** | Simple authentication | Low | Web/mobile hybrid |
| **Login Widget** | Web only | Very Low | Websites only |
| **Mini Apps** | Telegram embedded apps | Medium | In-Telegram experience |

### 3.2 TDLibKit Implementation (Recommended for Native)

```swift
// Add via SPM: https://github.com/Swiftgram/TDLibKit

import TDLibKit

class TelegramAuthService: ObservableObject {
    private let api: TdApi
    @Published var authorizationState: AuthorizationState?
    @Published var isAuthenticated = false

    init() {
        let client = TdClientImpl()
        api = TdApi(client: client)

        // Handle updates
        api.client.run { [weak self] data in
            self?.handleUpdate(data)
        }
    }

    private func handleUpdate(_ data: Data) {
        guard let update = try? api.decoder.decode(Update.self, from: data) else {
            return
        }

        switch update {
        case .updateAuthorizationState(let state):
            handleAuthorizationState(state.authorizationState)
        default:
            break
        }
    }

    private func handleAuthorizationState(_ state: AuthorizationState) {
        DispatchQueue.main.async {
            self.authorizationState = state
        }

        switch state {
        case .authorizationStateWaitTdlibParameters:
            setTdlibParameters()

        case .authorizationStateWaitPhoneNumber:
            // Show phone number input UI
            break

        case .authorizationStateWaitCode(let info):
            // Show code input UI
            // info.codeInfo contains delivery details
            break

        case .authorizationStateWaitPassword(let info):
            // User has 2FA enabled, show password input
            break

        case .authorizationStateReady:
            DispatchQueue.main.async {
                self.isAuthenticated = true
            }

        default:
            break
        }
    }

    private func setTdlibParameters() {
        Task {
            try await api.setTdlibParameters(
                apiHash: "YOUR_API_HASH",
                apiId: YOUR_API_ID,
                applicationVersion: "1.0.0",
                databaseDirectory: getDatabasePath(),
                databaseEncryptionKey: Data(),
                deviceModel: "iPhone",
                enableStorageOptimizer: true,
                filesDirectory: getFilesPath(),
                ignoreFileNames: false,
                systemLanguageCode: "en",
                systemVersion: UIDevice.current.systemVersion,
                useChatInfoDatabase: true,
                useFileDatabase: true,
                useMessageDatabase: true,
                useSecretChats: false,
                useTestDc: false
            )
        }
    }

    func setPhoneNumber(_ phoneNumber: String) {
        Task {
            try await api.setAuthenticationPhoneNumber(
                phoneNumber: phoneNumber,
                settings: nil
            )
        }
    }

    func checkCode(_ code: String) {
        Task {
            try await api.checkAuthenticationCode(code: code)
        }
    }

    func checkPassword(_ password: String) {
        Task {
            try await api.checkAuthenticationPassword(password: password)
        }
    }

    private func getDatabasePath() -> String {
        let paths = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)
        return paths[0].appendingPathComponent("td").path
    }

    private func getFilesPath() -> String {
        let paths = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)
        return paths[0].appendingPathComponent("td_files").path
    }
}
```

### 3.3 Bot API + Deep Links (Simpler Alternative)

```swift
class TelegramBotAuthService: ObservableObject {
    private let botUsername = "fancai_auth_bot"
    private let baseURL = "https://api.fancai.ru"

    @Published var authToken: String?

    // Generate unique auth session
    func startAuth() async -> String {
        // Generate session ID on backend
        let sessionId = UUID().uuidString

        // Store session, return to user
        return sessionId
    }

    // Open Telegram with deep link
    func openTelegramAuth(sessionId: String) {
        let deepLink = "tg://resolve?domain=\(botUsername)&start=\(sessionId)"

        if let url = URL(string: deepLink) {
            if UIApplication.shared.canOpenURL(url) {
                UIApplication.shared.open(url)
            } else {
                // Fallback to web
                if let webURL = URL(string: "https://t.me/\(botUsername)?start=\(sessionId)") {
                    UIApplication.shared.open(webURL)
                }
            }
        }
    }

    // Poll backend for auth completion
    func pollForAuth(sessionId: String) async throws -> AuthResult {
        // Backend polls Telegram bot for user confirmation
        // Returns JWT tokens when user confirms in Telegram

        for _ in 0..<60 { // Poll for 60 seconds max
            let result = try await checkAuthStatus(sessionId: sessionId)
            if result.isComplete {
                return result
            }
            try await Task.sleep(nanoseconds: 2_000_000_000) // 2 seconds
        }

        throw AuthError.timeout
    }

    private func checkAuthStatus(sessionId: String) async throws -> AuthResult {
        // GET /api/v1/auth/telegram/status/{sessionId}
        // Returns { isComplete: bool, tokens: { access_token, refresh_token } }
        fatalError("Implement API call")
    }
}

struct AuthResult {
    let isComplete: Bool
    let accessToken: String?
    let refreshToken: String?
}

enum AuthError: Error {
    case timeout
    case invalidSession
}
```

### 3.4 2025-2026 Updates

**Passkeys Support (December 2025):**
Telegram now supports passkeys for biometric authentication:
- Face ID / Touch ID for app unlock
- Not a replacement for SMS OTP (still required for account creation)
- Available in Telegram v12.2.2+

---

## 4. Email + Password

### 4.1 SwiftUI Form Implementation

```swift
import SwiftUI

struct EmailPasswordView: View {
    @StateObject private var viewModel = EmailPasswordViewModel()
    @FocusState private var focusedField: Field?

    enum Field {
        case email, password, confirmPassword
    }

    var body: some View {
        VStack(spacing: 24) {
            // Email Field
            VStack(alignment: .leading, spacing: 4) {
                Text("Email")
                    .font(.subheadline)
                    .foregroundColor(.secondary)

                TextField("your@email.com", text: $viewModel.email)
                    .textFieldStyle(.roundedBorder)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .autocapitalization(.none)
                    .autocorrectionDisabled()
                    .focused($focusedField, equals: .email)
                    .onChange(of: viewModel.email) { _ in
                        viewModel.validateEmail()
                    }

                if let error = viewModel.emailError {
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.red)
                }
            }

            // Password Field
            VStack(alignment: .leading, spacing: 4) {
                Text("Password")
                    .font(.subheadline)
                    .foregroundColor(.secondary)

                SecureField("Password", text: $viewModel.password)
                    .textFieldStyle(.roundedBorder)
                    .textContentType(viewModel.isRegistering ? .newPassword : .password)
                    .focused($focusedField, equals: .password)
                    .onChange(of: viewModel.password) { _ in
                        viewModel.validatePassword()
                    }

                if let error = viewModel.passwordError {
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.red)
                }

                // Password strength indicator (registration only)
                if viewModel.isRegistering {
                    PasswordStrengthView(strength: viewModel.passwordStrength)
                }
            }

            // Confirm Password (registration only)
            if viewModel.isRegistering {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Confirm Password")
                        .font(.subheadline)
                        .foregroundColor(.secondary)

                    SecureField("Confirm password", text: $viewModel.confirmPassword)
                        .textFieldStyle(.roundedBorder)
                        .textContentType(.newPassword)
                        .focused($focusedField, equals: .confirmPassword)

                    if let error = viewModel.confirmPasswordError {
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.red)
                    }
                }
            }

            // Submit Button
            Button(action: viewModel.submit) {
                if viewModel.isLoading {
                    ProgressView()
                        .tint(.white)
                } else {
                    Text(viewModel.isRegistering ? "Create Account" : "Sign In")
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .background(viewModel.isFormValid ? Color.accentColor : Color.gray)
            .foregroundColor(.white)
            .cornerRadius(8)
            .disabled(!viewModel.isFormValid || viewModel.isLoading)

            // Forgot Password
            if !viewModel.isRegistering {
                Button("Forgot password?") {
                    viewModel.showForgotPassword = true
                }
                .font(.subheadline)
            }

            // Toggle Registration/Login
            Button(viewModel.isRegistering ? "Already have an account? Sign In" : "Don't have an account? Sign Up") {
                withAnimation {
                    viewModel.isRegistering.toggle()
                    viewModel.clearErrors()
                }
            }
            .font(.subheadline)
        }
        .padding()
        .sheet(isPresented: $viewModel.showForgotPassword) {
            ForgotPasswordView()
        }
    }
}

struct PasswordStrengthView: View {
    let strength: PasswordStrength

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<4, id: \.self) { index in
                Rectangle()
                    .fill(index < strength.level ? strength.color : Color.gray.opacity(0.3))
                    .frame(height: 4)
            }
        }
        .cornerRadius(2)

        Text(strength.description)
            .font(.caption)
            .foregroundColor(strength.color)
    }
}

enum PasswordStrength {
    case weak, fair, good, strong

    var level: Int {
        switch self {
        case .weak: return 1
        case .fair: return 2
        case .good: return 3
        case .strong: return 4
        }
    }

    var color: Color {
        switch self {
        case .weak: return .red
        case .fair: return .orange
        case .good: return .yellow
        case .strong: return .green
        }
    }

    var description: String {
        switch self {
        case .weak: return "Weak"
        case .fair: return "Fair"
        case .good: return "Good"
        case .strong: return "Strong"
        }
    }
}
```

### 4.2 Validation Logic

```swift
class EmailPasswordViewModel: ObservableObject {
    @Published var email = ""
    @Published var password = ""
    @Published var confirmPassword = ""
    @Published var isRegistering = false
    @Published var isLoading = false

    @Published var emailError: String?
    @Published var passwordError: String?
    @Published var confirmPasswordError: String?
    @Published var showForgotPassword = false

    var passwordStrength: PasswordStrength {
        calculatePasswordStrength(password)
    }

    var isFormValid: Bool {
        let emailValid = isValidEmail(email) && emailError == nil
        let passwordValid = isValidPassword(password) && passwordError == nil

        if isRegistering {
            return emailValid && passwordValid && password == confirmPassword
        }
        return emailValid && passwordValid
    }

    // MARK: - Validation

    func validateEmail() {
        if email.isEmpty {
            emailError = nil
            return
        }

        if !isValidEmail(email) {
            emailError = "Please enter a valid email address"
        } else {
            emailError = nil
        }
    }

    func validatePassword() {
        if password.isEmpty {
            passwordError = nil
            return
        }

        var errors: [String] = []

        if password.count < 8 {
            errors.append("At least 8 characters")
        }
        if !password.contains(where: { $0.isUppercase }) {
            errors.append("One uppercase letter")
        }
        if !password.contains(where: { $0.isLowercase }) {
            errors.append("One lowercase letter")
        }
        if !password.contains(where: { $0.isNumber }) {
            errors.append("One number")
        }

        passwordError = errors.isEmpty ? nil : "Required: " + errors.joined(separator: ", ")

        // Validate confirm password match
        if isRegistering && !confirmPassword.isEmpty && password != confirmPassword {
            confirmPasswordError = "Passwords do not match"
        } else {
            confirmPasswordError = nil
        }
    }

    private func isValidEmail(_ email: String) -> Bool {
        let emailRegex = "^[A-Z0-9a-z._%+-]+@([A-Za-z0-9-]+\\.)+[A-Za-z]{2,49}$"
        let predicate = NSPredicate(format: "SELF MATCHES %@", emailRegex)
        return predicate.evaluate(with: email)
    }

    private func isValidPassword(_ password: String) -> Bool {
        // Minimum 8 characters, at least one uppercase, one lowercase, one number
        let passwordRegex = "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).{8,}$"
        let predicate = NSPredicate(format: "SELF MATCHES %@", passwordRegex)
        return predicate.evaluate(with: password)
    }

    private func calculatePasswordStrength(_ password: String) -> PasswordStrength {
        var score = 0

        if password.count >= 8 { score += 1 }
        if password.count >= 12 { score += 1 }
        if password.contains(where: { $0.isUppercase }) { score += 1 }
        if password.contains(where: { $0.isLowercase }) { score += 1 }
        if password.contains(where: { $0.isNumber }) { score += 1 }
        if password.contains(where: { "!@#$%^&*()_+-=[]{}|;:,.<>?".contains($0) }) { score += 1 }

        switch score {
        case 0...2: return .weak
        case 3: return .fair
        case 4...5: return .good
        default: return .strong
        }
    }

    func clearErrors() {
        emailError = nil
        passwordError = nil
        confirmPasswordError = nil
    }

    // MARK: - Actions

    func submit() {
        validateEmail()
        validatePassword()

        guard isFormValid else { return }

        isLoading = true

        Task {
            if isRegistering {
                await register()
            } else {
                await login()
            }

            await MainActor.run {
                isLoading = false
            }
        }
    }

    private func login() async {
        // POST /api/v1/auth/login
        // Body: { email, password }
        // Response: { access_token, refresh_token, user }
    }

    private func register() async {
        // POST /api/v1/auth/register
        // Body: { email, password, full_name }
        // Response: { access_token, refresh_token, user }
    }
}
```

### 4.3 Forgot Password Flow

```swift
struct ForgotPasswordView: View {
    @StateObject private var viewModel = ForgotPasswordViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Text("Reset Password")
                    .font(.title2)
                    .fontWeight(.bold)

                Text("Enter your email address and we'll send you a link to reset your password.")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)

                TextField("Email", text: $viewModel.email)
                    .textFieldStyle(.roundedBorder)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .autocapitalization(.none)

                Button(action: viewModel.sendResetLink) {
                    if viewModel.isLoading {
                        ProgressView()
                            .tint(.white)
                    } else {
                        Text("Send Reset Link")
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: 50)
                .background(viewModel.isValidEmail ? Color.accentColor : Color.gray)
                .foregroundColor(.white)
                .cornerRadius(8)
                .disabled(!viewModel.isValidEmail || viewModel.isLoading)

                Spacer()
            }
            .padding()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .alert("Email Sent", isPresented: $viewModel.showSuccess) {
                Button("OK") {
                    dismiss()
                }
            } message: {
                Text("Check your email for password reset instructions.")
            }
        }
    }
}

class ForgotPasswordViewModel: ObservableObject {
    @Published var email = ""
    @Published var isLoading = false
    @Published var showSuccess = false

    var isValidEmail: Bool {
        let emailRegex = "^[A-Z0-9a-z._%+-]+@([A-Za-z0-9-]+\\.)+[A-Za-z]{2,49}$"
        let predicate = NSPredicate(format: "SELF MATCHES %@", emailRegex)
        return predicate.evaluate(with: email)
    }

    func sendResetLink() {
        guard isValidEmail else { return }

        isLoading = true

        Task {
            // POST /api/v1/auth/forgot-password
            // Body: { email }

            // Always show success (don't reveal if email exists)
            await MainActor.run {
                isLoading = false
                showSuccess = true
            }
        }
    }
}
```

### 4.4 Password Requirements (Recommended)

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| Length | 8 characters | 12+ characters |
| Uppercase | 1 | 1+ |
| Lowercase | 1 | 1+ |
| Numbers | 1 | 1+ |
| Special characters | 0 | 1+ |
| Maximum length | 72 (bcrypt limit) | 128 |

---

## 5. JWT Integration with Backend

### 5.1 Current fancai Backend Structure

The existing fancai backend uses:
- **Algorithm:** HS256 (configurable via `settings.ALGORITHM`)
- **Access token expiry:** Configurable via `settings.ACCESS_TOKEN_EXPIRE_MINUTES`
- **Refresh token expiry:** Configurable via `settings.REFRESH_TOKEN_EXPIRE_DAYS`
- **Token blacklist:** Redis-based for logout functionality

### 5.2 Keychain Storage Implementation

```swift
import Security
import Foundation

class KeychainService {
    static let shared = KeychainService()

    private let serviceName = "com.fancai.reader"

    enum KeychainError: Error {
        case duplicateEntry
        case unknown(OSStatus)
        case notFound
        case invalidData
    }

    // MARK: - Token Keys

    private enum Keys {
        static let accessToken = "access_token"
        static let refreshToken = "refresh_token"
        static let tokenExpiry = "token_expiry"
    }

    // MARK: - Save Token

    func saveAccessToken(_ token: String) throws {
        try save(key: Keys.accessToken, data: token.data(using: .utf8)!)
    }

    func saveRefreshToken(_ token: String) throws {
        try save(key: Keys.refreshToken, data: token.data(using: .utf8)!)
    }

    func saveTokenExpiry(_ date: Date) throws {
        let data = try JSONEncoder().encode(date)
        try save(key: Keys.tokenExpiry, data: data)
    }

    private func save(key: String, data: Data) throws {
        // Delete existing item first
        try? delete(key: key)

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]

        let status = SecItemAdd(query as CFDictionary, nil)

        guard status == errSecSuccess else {
            throw KeychainError.unknown(status)
        }
    }

    // MARK: - Retrieve Token

    func getAccessToken() throws -> String {
        let data = try retrieve(key: Keys.accessToken)
        guard let token = String(data: data, encoding: .utf8) else {
            throw KeychainError.invalidData
        }
        return token
    }

    func getRefreshToken() throws -> String {
        let data = try retrieve(key: Keys.refreshToken)
        guard let token = String(data: data, encoding: .utf8) else {
            throw KeychainError.invalidData
        }
        return token
    }

    func getTokenExpiry() throws -> Date {
        let data = try retrieve(key: Keys.tokenExpiry)
        return try JSONDecoder().decode(Date.self, from: data)
    }

    private func retrieve(key: String) throws -> Data {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess else {
            if status == errSecItemNotFound {
                throw KeychainError.notFound
            }
            throw KeychainError.unknown(status)
        }

        guard let data = result as? Data else {
            throw KeychainError.invalidData
        }

        return data
    }

    // MARK: - Delete Token

    func deleteAllTokens() {
        try? delete(key: Keys.accessToken)
        try? delete(key: Keys.refreshToken)
        try? delete(key: Keys.tokenExpiry)
    }

    private func delete(key: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key
        ]

        let status = SecItemDelete(query as CFDictionary)

        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.unknown(status)
        }
    }

    // MARK: - First Launch Cleanup

    func clearOnFirstLaunch() {
        let hasLaunchedKey = "hasLaunchedBefore"
        let defaults = UserDefaults.standard

        if !defaults.bool(forKey: hasLaunchedKey) {
            deleteAllTokens()
            defaults.set(true, forKey: hasLaunchedKey)
        }
    }
}
```

### 5.3 Token Refresh Manager (Actor-based)

```swift
import Foundation

actor AuthManager {
    static let shared = AuthManager()

    private let keychain = KeychainService.shared
    private let baseURL = "https://api.fancai.ru"

    private var refreshTask: Task<String, Error>?

    // MARK: - Get Valid Token

    func getValidAccessToken() async throws -> String {
        // Check if we have a valid token
        if let token = try? keychain.getAccessToken(),
           let expiry = try? keychain.getTokenExpiry(),
           expiry > Date().addingTimeInterval(60) { // 60 second buffer
            return token
        }

        // Need to refresh - but avoid duplicate refresh requests
        if let existingTask = refreshTask {
            return try await existingTask.value
        }

        // Create new refresh task
        let task = Task<String, Error> {
            defer { refreshTask = nil }
            return try await performTokenRefresh()
        }

        refreshTask = task
        return try await task.value
    }

    private func performTokenRefresh() async throws -> String {
        guard let refreshToken = try? keychain.getRefreshToken() else {
            throw AuthError.noRefreshToken
        }

        // POST /api/v1/auth/refresh
        var request = URLRequest(url: URL(string: "\(baseURL)/api/v1/auth/refresh")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["refresh_token": refreshToken])

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw AuthError.invalidResponse
        }

        switch httpResponse.statusCode {
        case 200:
            let tokens = try JSONDecoder().decode(TokenResponse.self, from: data)

            // Save new tokens
            try keychain.saveAccessToken(tokens.accessToken)
            try keychain.saveRefreshToken(tokens.refreshToken)

            // Calculate and save expiry (assuming 15 min access token)
            let expiry = Date().addingTimeInterval(15 * 60)
            try keychain.saveTokenExpiry(expiry)

            return tokens.accessToken

        case 401:
            // Refresh token expired - need to re-login
            keychain.deleteAllTokens()
            throw AuthError.sessionExpired

        default:
            throw AuthError.refreshFailed
        }
    }

    // MARK: - Authenticated Request

    func authenticatedRequest(_ request: URLRequest, allowRetry: Bool = true) async throws -> (Data, URLResponse) {
        var request = request

        let token = try await getValidAccessToken()
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw AuthError.invalidResponse
        }

        // Handle 401 - token might have been invalidated server-side
        if httpResponse.statusCode == 401 && allowRetry {
            // Clear cached token and retry once
            refreshTask = nil
            return try await authenticatedRequest(request, allowRetry: false)
        }

        return (data, response)
    }

    // MARK: - Logout

    func logout() async {
        // Call backend logout to invalidate token
        if let token = try? keychain.getAccessToken() {
            var request = URLRequest(url: URL(string: "\(baseURL)/api/v1/auth/logout")!)
            request.httpMethod = "POST"
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

            _ = try? await URLSession.shared.data(for: request)
        }

        // Clear local tokens
        keychain.deleteAllTokens()
    }
}

// MARK: - Supporting Types

struct TokenResponse: Codable {
    let accessToken: String
    let refreshToken: String
    let tokenType: String

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case tokenType = "token_type"
    }
}

enum AuthError: Error, LocalizedError {
    case noRefreshToken
    case sessionExpired
    case refreshFailed
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .noRefreshToken:
            return "No refresh token available"
        case .sessionExpired:
            return "Your session has expired. Please sign in again."
        case .refreshFailed:
            return "Failed to refresh authentication"
        case .invalidResponse:
            return "Invalid server response"
        }
    }
}
```

### 5.4 Secure Storage Best Practices

| Practice | Implementation |
|----------|----------------|
| Use Keychain, not UserDefaults | `kSecClassGenericPassword` |
| Device-only access | `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` |
| Clear on first launch | Check `hasLaunchedBefore` flag |
| Short-lived access tokens | 15-30 minutes recommended |
| Rotate refresh tokens | Issue new refresh token on each refresh |
| HTTPS only | URLSession with ATS enabled |
| Certificate pinning | Optional for high-security apps |

### 5.5 Using KeychainAccess Library (Alternative)

```swift
// Add via SPM: https://github.com/kishikawakatsumi/KeychainAccess

import KeychainAccess

class TokenStorage {
    private let keychain = Keychain(service: "com.fancai.reader")
        .accessibility(.whenUnlockedThisDeviceOnly)

    func saveTokens(access: String, refresh: String) throws {
        try keychain.set(access, key: "access_token")
        try keychain.set(refresh, key: "refresh_token")
    }

    func getAccessToken() throws -> String? {
        try keychain.get("access_token")
    }

    func getRefreshToken() throws -> String? {
        try keychain.get("refresh_token")
    }

    func clearTokens() throws {
        try keychain.remove("access_token")
        try keychain.remove("refresh_token")
    }
}
```

---

## 6. Biometric Authentication

### 6.1 LocalAuthentication Framework Setup

**Info.plist:**
```xml
<key>NSFaceIDUsageDescription</key>
<string>fancai uses Face ID to quickly and securely sign you in.</string>
```

### 6.2 SwiftUI Implementation

```swift
import SwiftUI
import LocalAuthentication

class BiometricAuthService: ObservableObject {
    @Published var isAuthenticated = false
    @Published var biometricType: BiometricType = .none
    @Published var errorMessage: String?

    enum BiometricType {
        case none
        case touchID
        case faceID
        case opticID // Vision Pro

        var displayName: String {
            switch self {
            case .none: return "Passcode"
            case .touchID: return "Touch ID"
            case .faceID: return "Face ID"
            case .opticID: return "Optic ID"
            }
        }

        var iconName: String {
            switch self {
            case .none: return "lock.fill"
            case .touchID: return "touchid"
            case .faceID: return "faceid"
            case .opticID: return "opticid"
            }
        }
    }

    init() {
        checkBiometricType()
    }

    // MARK: - Check Biometric Availability

    func checkBiometricType() {
        let context = LAContext()
        var error: NSError?

        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            biometricType = .none
            return
        }

        switch context.biometryType {
        case .touchID:
            biometricType = .touchID
        case .faceID:
            biometricType = .faceID
        case .opticID:
            biometricType = .opticID
        case .none:
            biometricType = .none
        @unknown default:
            biometricType = .none
        }
    }

    var isBiometricAvailable: Bool {
        biometricType != .none
    }

    // MARK: - Authenticate

    func authenticate() async -> Bool {
        let context = LAContext()
        var error: NSError?

        // Check if biometrics or passcode is available
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            await MainActor.run {
                errorMessage = error?.localizedDescription ?? "Biometric authentication not available"
            }
            return false
        }

        do {
            // Use .deviceOwnerAuthentication to allow passcode fallback
            let success = try await context.evaluatePolicy(
                .deviceOwnerAuthentication,
                localizedReason: "Sign in to fancai"
            )

            await MainActor.run {
                isAuthenticated = success
            }
            return success

        } catch let error as LAError {
            await MainActor.run {
                handleLAError(error)
            }
            return false
        } catch {
            await MainActor.run {
                errorMessage = error.localizedDescription
            }
            return false
        }
    }

    // MARK: - Biometrics Only (No Passcode Fallback)

    func authenticateWithBiometricsOnly() async -> Bool {
        let context = LAContext()
        context.localizedFallbackTitle = "" // Hide "Enter Password" button

        var error: NSError?

        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            await MainActor.run {
                errorMessage = "Biometric authentication not available"
            }
            return false
        }

        do {
            let success = try await context.evaluatePolicy(
                .deviceOwnerAuthenticationWithBiometrics,
                localizedReason: "Use \(biometricType.displayName) to unlock"
            )

            await MainActor.run {
                isAuthenticated = success
            }
            return success

        } catch {
            await MainActor.run {
                handleLAError(error as? LAError ?? LAError(.authenticationFailed))
            }
            return false
        }
    }

    private func handleLAError(_ error: LAError) {
        switch error.code {
        case .authenticationFailed:
            errorMessage = "Authentication failed. Please try again."
        case .userCancel:
            errorMessage = nil // User cancelled, no error message needed
        case .userFallback:
            errorMessage = nil // User chose to use passcode
        case .biometryNotAvailable:
            errorMessage = "\(biometricType.displayName) is not available on this device."
        case .biometryNotEnrolled:
            errorMessage = "No \(biometricType.displayName) enrolled. Please set up in Settings."
        case .biometryLockout:
            errorMessage = "\(biometricType.displayName) is locked. Use passcode to unlock."
        case .passcodeNotSet:
            errorMessage = "Please set a passcode in Settings to use this feature."
        default:
            errorMessage = error.localizedDescription
        }
    }
}
```

### 6.3 Biometric Login View

```swift
struct BiometricLoginView: View {
    @StateObject private var biometricAuth = BiometricAuthService()
    @State private var showManualLogin = false

    var body: some View {
        VStack(spacing: 32) {
            Spacer()

            // App Logo
            Image("fancai_logo")
                .resizable()
                .scaledToFit()
                .frame(width: 120, height: 120)

            Text("Welcome back")
                .font(.title)
                .fontWeight(.bold)

            // Biometric Button
            if biometricAuth.isBiometricAvailable {
                Button(action: {
                    Task {
                        let success = await biometricAuth.authenticate()
                        if success {
                            // Navigate to main app
                        }
                    }
                }) {
                    VStack(spacing: 12) {
                        Image(systemName: biometricAuth.biometricType.iconName)
                            .font(.system(size: 48))
                        Text("Sign in with \(biometricAuth.biometricType.displayName)")
                            .font(.headline)
                    }
                    .foregroundColor(.accentColor)
                    .frame(maxWidth: .infinity)
                    .frame(height: 120)
                    .background(Color.accentColor.opacity(0.1))
                    .cornerRadius(16)
                }
                .padding(.horizontal)
            }

            // Manual Login Option
            Button("Sign in with password") {
                showManualLogin = true
            }
            .font(.subheadline)

            // Error Message
            if let error = biometricAuth.errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundColor(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }

            Spacer()
        }
        .sheet(isPresented: $showManualLogin) {
            EmailPasswordView()
        }
        .onAppear {
            // Auto-prompt for biometric on appear
            if biometricAuth.isBiometricAvailable {
                Task {
                    await biometricAuth.authenticate()
                }
            }
        }
    }
}
```

### 6.4 App Lock Feature

```swift
class AppLockManager: ObservableObject {
    static let shared = AppLockManager()

    @Published var isLocked = true
    @Published var isEnabled: Bool {
        didSet {
            UserDefaults.standard.set(isEnabled, forKey: "appLockEnabled")
        }
    }

    private let biometricAuth = BiometricAuthService()
    private var backgroundTime: Date?
    private let lockTimeout: TimeInterval = 5 * 60 // 5 minutes

    init() {
        isEnabled = UserDefaults.standard.bool(forKey: "appLockEnabled")
        setupNotifications()
    }

    private func setupNotifications() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appDidEnterBackground),
            name: UIApplication.didEnterBackgroundNotification,
            object: nil
        )

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appWillEnterForeground),
            name: UIApplication.willEnterForegroundNotification,
            object: nil
        )
    }

    @objc private func appDidEnterBackground() {
        backgroundTime = Date()
    }

    @objc private func appWillEnterForeground() {
        guard isEnabled else {
            isLocked = false
            return
        }

        if let backgroundTime = backgroundTime {
            let elapsed = Date().timeIntervalSince(backgroundTime)
            if elapsed > lockTimeout {
                isLocked = true
            }
        }

        self.backgroundTime = nil
    }

    func unlock() async -> Bool {
        let success = await biometricAuth.authenticate()
        await MainActor.run {
            isLocked = !success
        }
        return success
    }
}

// Usage in App
struct ContentView: View {
    @StateObject private var appLock = AppLockManager.shared

    var body: some View {
        ZStack {
            MainTabView()

            if appLock.isLocked && appLock.isEnabled {
                LockScreenView()
                    .transition(.opacity)
            }
        }
    }
}
```

### 6.5 Authentication Policies Comparison

| Policy | Description | Use Case |
|--------|-------------|----------|
| `.deviceOwnerAuthenticationWithBiometrics` | Biometrics only | Quick unlock |
| `.deviceOwnerAuthentication` | Biometrics with passcode fallback | Login |

---

## 7. Comparison Table

| Method | User Friction | Security | Implementation Complexity | App Store Requirement |
|--------|---------------|----------|---------------------------|----------------------|
| Sign in with Apple | Low | High | Medium | **Required** if using social login |
| Google Sign-In | Low | High | Medium | Optional |
| Telegram | Medium | High | High | Optional |
| Email + Password | High | Medium | Low | Optional |
| Biometrics | Very Low | Very High | Low | N/A (local only) |

### Recommended Authentication Flow

```
                    +------------------+
                    |   App Launch     |
                    +--------+---------+
                             |
                    +--------v---------+
                    | Has stored JWT?  |
                    +--------+---------+
                             |
              Yes            |           No
        +--------------------+--------------------+
        |                                         |
+-------v-------+                         +-------v-------+
| Biometric     |                         | Login Screen  |
| Verification  |                         +-------+-------+
+-------+-------+                                 |
        |                         +---------------+---------------+
   Success?                       |               |               |
        |                   Apple         Google          Email
+-------+-------+               |               |               |
|  Yes  |  No   |         +-----v-----+   +-----v-----+   +-----v-----+
+---+---+---+---+         | Apple     |   | Google    |   | Email/    |
    |       |             | Sign-In   |   | Sign-In   |   | Password  |
    |   +---v---+         +-----+-----+   +-----+-----+   +-----+-----+
    |   |Fallback|              |               |               |
    |   |to Login|              +---------------+---------------+
    |   +---+---+                               |
    |       |                           +-------v-------+
    +-------+                           | Backend JWT   |
            |                           | Generation    |
    +-------v-------+                   +-------+-------+
    | Main App      |                           |
    +---------------+                   +-------v-------+
                                        | Store in      |
                                        | Keychain      |
                                        +-------+-------+
                                                |
                                        +-------v-------+
                                        | Main App      |
                                        +---------------+
```

---

## 8. Recommendations for fancai

### 8.1 Immediate Implementation (MVP)

1. **Sign in with Apple** - Required for App Store if using any social login
2. **Email + Password** - Standard fallback option
3. **JWT with Keychain storage** - Secure token management
4. **Biometric app unlock** - Convenience feature for returning users

### 8.2 Phase 2 (Post-Launch)

1. **Google Sign-In** - Wider audience reach
2. **Telegram Login** - If targeting Telegram user base

### 8.3 Backend Endpoints to Add

```
POST /api/v1/auth/apple          # Apple Sign-In verification
POST /api/v1/auth/google         # Google Sign-In verification
POST /api/v1/auth/telegram       # Telegram auth callback
POST /api/v1/auth/forgot-password # Password reset request
POST /api/v1/auth/reset-password  # Password reset with token
```

### 8.4 Security Checklist

- [ ] Implement Sign in with Apple (mandatory)
- [ ] Use Keychain for token storage (not UserDefaults)
- [ ] Clear Keychain on first app launch
- [ ] Implement token refresh with Actor pattern
- [ ] Add biometric authentication option
- [ ] Verify all OAuth tokens on backend
- [ ] Use HTTPS exclusively
- [ ] Implement proper logout (blacklist tokens)
- [ ] Handle credential state changes (Apple)
- [ ] Add password strength validation

---

## 9. Sources

### Apple Documentation
- [Implementing User Authentication with Sign in with Apple](https://developer.apple.com/documentation/AuthenticationServices/implementing-user-authentication-with-sign-in-with-apple)
- [Authenticating Users with Sign in with Apple](https://developer.apple.com/documentation/signinwithapple/authenticating-users-with-sign-in-with-apple)
- [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Token Validation](https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens)

### Google Documentation
- [Google Sign-In for iOS](https://developers.google.com/identity/sign-in/ios/sign-in)
- [Get Started with Google Sign-In](https://developers.google.com/identity/sign-in/ios/start-integrating)
- [Add Sign in with Google to an iOS app (Codelab)](https://codelabs.developers.google.com/codelabs/sign-in-with-google-ios)

### Telegram Documentation
- [TDLib (Telegram Database Library)](https://core.telegram.org/tdlib)
- [Getting Started with TDLib](https://core.telegram.org/tdlib/getting-started)
- [Deep Links](https://core.telegram.org/api/links)
- [TDLibKit (Swift wrapper)](https://github.com/Swiftgram/TDLibKit)

### JWT & Security
- [Secure Token Storage Best Practices](https://capgo.app/blog/secure-token-storage-best-practices-for-mobile-developers/)
- [JWT Storage Best Practices (WorkOS)](https://workos.com/blog/secure-jwt-storage)
- [Keychain Best Practices](https://medium.com/@ios-interview/keychain-best-practices-for-storing-sensitive-data-ios-development-a27d2d3ed34b)
- [Building a Token Refresh Flow with Async/Await](https://www.donnywals.com/building-a-token-refresh-flow-with-async-await-and-swift-concurrency/)
- [KeychainAccess Library](https://github.com/kishikawakatsumi/KeychainAccess)

### SwiftUI & Biometrics
- [Using Touch ID and Face ID with SwiftUI](https://www.hackingwithswift.com/books/ios-swiftui/using-touch-id-and-face-id-with-swiftui)
- [FaceID and TouchID Integration in SwiftUI](https://medium.com/@swatimishra2824/faceid-and-touchid-integration-in-swiftui-a-complete-guide-b9842042e412)
- [SwiftUI Form Validation](https://www.dhiwise.com/blog/design-converter/swiftui-form-validation-tips-for-reliable-user-input)
- [The Ultimate Guide to Validation Patterns in SwiftUI](https://azamsharp.com/2024/12/18/the-ultimate-guide-to-validation-patterns-in-swiftui.html)

### Tutorials & Guides
- [Sign in with Apple on a SwiftUI Application](https://www.createwithswift.com/sign-in-with-apple-on-a-swiftui-application/)
- [Implementing Sign in with Apple in SwiftUI (Medium)](https://medium.com/@mohamed.hacine00/implementing-sign-in-with-apple-in-swiftui-a-complete-guide-40fae22cdf1d)
- [Sign in with Apple Tutorial: Backend Token Verification](https://sarunw.com/posts/sign-in-with-apple-3/)
- [How to Add Auth to Your Apple App for App Store (WorkOS)](https://workos.com/blog/apple-app-store-authentication-sign-in-with-apple-2025)
