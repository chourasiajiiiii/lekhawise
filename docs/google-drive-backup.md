# Google Drive backup: one-time Google setup

LekhaWise backs up to the user's own Google Drive, into the app's private **appDataFolder** (hidden in Drive,
only LekhaWise can read it). The app asks only for the narrow `drive.appdata` permission. There is no server:
the phone talks to Google Drive directly.

Google only lets an app sign people in after the app is registered in a Google Cloud project. This is free and
done once.

## 1. Create the project and turn on the Drive API

1. Open <https://console.cloud.google.com/> with the Google account that will own the app.
2. Create a project, for example **LekhaWise**.
3. **APIs & Services → Library**, search **Google Drive API**, click **Enable**.

## 2. Consent screen (what people see when signing in)

In **Google Auth Platform** (older consoles call it **OAuth consent screen**):

1. **Branding**: app name *LekhaWise*, your support email, and a developer contact email.
2. **Audience**: *External*.
   - While the app is in **Testing**, only the accounts listed under **Test users** (up to 100) can sign in,
     and Google asks them to sign in again about once a week. Add your own Gmail address there to try it out.
   - For everyone, click **Publish app**. `drive.appdata` is a non-sensitive scope, so this does not need
     Google's security review. Google may still ask to verify the app's name and logo.
3. **Data access → Add or remove scopes**: add `https://www.googleapis.com/auth/drive.appdata`.

## 3. Android client

**Clients → Create client → Android**:

- Package name: `com.lekhawise.app`
- SHA-1 certificate fingerprint of the key that signs the APK. The current build is signed with React Native's
  development key:

  `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`

  Print it again with `keytool -list -v -keystore android/app/debug.keystore -storepass android`.

Nothing needs to be copied into the app for Android: Google recognises the app by package name and signature.

**When the app gets its own release key (needed before publishing on Google Play, because the development key is
public), add another Android client with that key's SHA-1.** With Play App Signing, also add the *App signing key*
SHA-1 shown in Play Console → Test and release → App integrity.

## 4. iPhone client (later)

**Clients → Create client → iOS**, bundle ID `com.lekhawise.app`. Copy into `google-oauth.json` at the project root:

- `iosClientId`: the client ID (`….apps.googleusercontent.com`)
- `iosUrlScheme`: the *iOS URL scheme* shown for that client (`com.googleusercontent.apps.…`)

Then rebuild the iPhone app. Until these are filled in, the Google Drive section is hidden on iPhone.

## 5. Rebuild

Rebuild the app (the sign-in library is native code, so Expo Go cannot use it). The **Google Drive** section appears
on **More → Backup & export**.

## How it behaves

- **Sign in with Google**, then **Back up to Google Drive now**. If the account already has backups (a new phone),
  the list of backups opens right away.
- **Automatic backup** (Off / Daily / Weekly) runs when the app is opened and the last Drive backup is older than
  that. The 10 newest backups are kept and older ones are deleted.
- **Restore from Google Drive** lists the backups with date, phone and number of transactions. Choosing one shows
  the same preview as a file restore before anything is replaced.
- Drive backups are not password protected (the account's own security protects them).
- Signing out keeps the backups in Drive. Uninstalling the app does not delete them either. Google deletes the
  app folder only when the user removes LekhaWise's access in their Google account settings.
