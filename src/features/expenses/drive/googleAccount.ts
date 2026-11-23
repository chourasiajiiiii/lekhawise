import { Platform } from 'react-native';

import googleOAuth from '../../../../google-oauth.json';
import { DRIVE_APPDATA_SCOPE } from './driveApi';

type GoogleSignInModule = typeof import('@react-native-google-signin/google-signin');

/**
 * The Google sign-in native module, or null where it is missing (Expo Go, unit tests). Loaded lazily so the rest
 * of the app works without it.
 */
let loaded: GoogleSignInModule | null | undefined;
function native(): GoogleSignInModule | null {
  if (loaded === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      loaded = require('@react-native-google-signin/google-signin') as GoogleSignInModule;
    } catch {
      loaded = null;
    }
  }
  return loaded;
}

/**
 * Google Drive backup is offered where sign-in can work: Android (its OAuth client is matched by package name and
 * signing certificate, so no ID is needed in the app) and iOS once google-oauth.json has the iOS client.
 */
export function isDriveBackupAvailable(): boolean {
  if (!native()) return false;
  if (Platform.OS === 'android') return true;
  return Platform.OS === 'ios' && Boolean(googleOAuth.iosClientId);
}

let configured = false;
function google() {
  const mod = native();
  if (!mod) throw new Error('Google sign-in is not available in this build.');
  if (!configured) {
    mod.GoogleSignin.configure({
      scopes: [DRIVE_APPDATA_SCOPE],
      webClientId: googleOAuth.webClientId || undefined,
      iosClientId: googleOAuth.iosClientId || undefined,
    });
    configured = true;
  }
  return mod;
}

/** The person cancelled the Google sign-in screen. */
export class SignInCancelledError extends Error {
  constructor() {
    super('Sign-in was cancelled.');
    this.name = 'SignInCancelledError';
  }
}

/** Shows Google's account chooser and asks for access to the app's Drive folder. Returns the account's email. */
export async function signInToGoogle(): Promise<string> {
  const mod = google();
  const { GoogleSignin, isSuccessResponse, isErrorWithCode, statusCodes } = mod;
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) throw new SignInCancelledError();
    // The Drive permission is a separate tick box on Google's screen; ask again if it was left unticked.
    if (!response.data.scopes.includes(DRIVE_APPDATA_SCOPE)) {
      const added = await GoogleSignin.addScopes({ scopes: [DRIVE_APPDATA_SCOPE] });
      if (!added || !isSuccessResponse(added) || !added.data.scopes.includes(DRIVE_APPDATA_SCOPE)) {
        throw new DrivePermissionError();
      }
    }
    return response.data.user.email;
  } catch (error) {
    if (isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED) throw new SignInCancelledError();
    throw error;
  }
}

/** Google's screen was confirmed without allowing access to Drive. */
export class DrivePermissionError extends Error {
  constructor() {
    super('LekhaWise needs permission to keep its backups in your Google Drive.');
    this.name = 'DrivePermissionError';
  }
}

export async function signOutOfGoogle(): Promise<void> {
  await google().GoogleSignin.signOut();
}

/**
 * A fresh access token for Drive, signing in silently with the remembered account when the app was restarted.
 * `retry` drops a token Google rejected (Android caches tokens) before asking for a new one.
 */
export async function driveAccessToken(rejected?: string): Promise<string> {
  const { GoogleSignin, isNoSavedCredentialFoundResponse } = google();
  if (rejected && Platform.OS === 'android') await GoogleSignin.clearCachedAccessToken(rejected);
  if (!GoogleSignin.getCurrentUser()) {
    const silent = await GoogleSignin.signInSilently();
    if (isNoSavedCredentialFoundResponse(silent)) throw new SignedOutError();
  }
  return (await GoogleSignin.getTokens()).accessToken;
}

/** No Google account is signed in any more (signed out elsewhere, or access was removed in the Google account). */
export class SignedOutError extends Error {
  constructor() {
    super('Sign in to Google again to use Drive backup.');
    this.name = 'SignedOutError';
  }
}
