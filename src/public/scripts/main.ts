/**
 * Copyright 2022 Google LLC
 * 
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * 
 *     https://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { html, render, $, showSnackbar, loading, _fetch } from './util';
import { WebAuthnRegistrationObject, WebAuthnAuthenticationObject, UserInfo } from './common';
import { base64url } from './base64url';
import { MDCRipple } from '@material/ripple';
import { initializeApp } from 'firebase/app';
import { Checkbox } from '@material/mwc-checkbox';
import * as firebaseui from 'firebaseui';
import {
  getAuth,
  connectAuthEmulator,
  GoogleAuthProvider,
  onAuthStateChanged,
  User
} from 'firebase/auth';
import { getAnalytics } from 'firebase/analytics';
import {
  RegistrationCredential,
  RegistrationCredentialJSON,
  AuthenticationCredential,
  AuthenticationCredentialJSON,
  PublicKeyCredentialCreationOptions,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptions,
  PublicKeyCredentialRequestOptionsJSON,
  PublicKeyCredentialDescriptorJSON
} from '@simplewebauthn/typescript-types';
import { IconButton } from '@material/mwc-icon-button';

const app = initializeApp({
  apiKey: "AIzaSyBC_U6UbKJE0evrgaITJSk6T_sZmMaZO-4",
  authDomain: "try-webauthn.firebaseapp.com",
  projectId: "try-webauthn",
  storageBucket: "try-webauthn.appspot.com",
  messagingSenderId: "557912693280",
  appId: "1:557912693280:web:c47da88d666eaf0f40fa45",
  measurementId: "G-NWVKPRNL5Q"
});

getAnalytics(app);

const auth = getAuth();
if (location.hostname === 'localhost') {
  connectAuthEmulator(auth, 'http://localhost:9099');
}
const ui = new firebaseui.auth.AuthUI(auth);
const icon = $('#user-icon');
const transportIconMap = {
  internal: "devices",
  usb: "usb",
  nfc: "nfc",
  ble: "bluetooth",
  cable: "cable",
  hybrid: "cable",
} as { [key: string]: string };

/**
 *  Verify ID Token received via Firebase Auth
 * @param authResult 
 * @returns always return `false`
 */
const verifyIdToken = async (user: User): Promise<UserInfo> => {
  const id_token = await user.getIdToken();
  return await _fetch('/auth/verify', { id_token });
}

/**
 * Display Firebase Auth UI
 */
const displaySignin = () => {
  loading.start();
  ui.start('#firebaseui-auth-container', {
    signInOptions: [ GoogleAuthProvider.PROVIDER_ID ],
    signInFlow: 'popup',
    callbacks: { signInSuccessWithAuthResult: () => false, }
  });
  $('#dialog').show();
};

/**
 * Sign out from Firebase Auth
 */
const onSignout = async (e: any) => {
  if (!confirm('Do you want to sign out?')) {
    e.stopPropagation();
    return;
  }
  $('#user-info').close();
  await auth.signOut();
  await _fetch('/auth/signout');
  icon.innerHTML = '';
  icon.setAttribute('icon', 'account_circle');
  $('#drawer').open = false;
  $('#credentials').innerHTML = '';
  showSnackbar('You are signed out.');
  displaySignin();
};

/**
 * Invoked when Firebase Auth status is changed.
 */
onAuthStateChanged(auth, async token => {
  if (!window.PublicKeyCredential) {
    render(html`
      <p>Your browser does not support WebAuthn.</p>
    `, $('#firebaseui-auth-container'));
    $('#dialog').show();
    return false;
  }

  let user: UserInfo;

  if (token) {
    // When signed in.
    try {
      user = await verifyIdToken(token);

      // User Info is stored in the local storage.
      // This will be deleted when signing out.
      const _userInfo = localStorage.getItem('userInfo');
      // If there's already stored user info, fill the User Info dialog with them.
      if (!_userInfo) {
        // If there's no previous user info, store the current user info.
        localStorage.setItem('userInfo', JSON.stringify(user));
        $('#username').value = user.name;
        $('#display-name').value = user.displayName;
        $('#picture-url').value = user.picture;
      } else {
        // If there's user info in the local storage, use it.
        const userInfo = JSON.parse(_userInfo);
        $('#username').value = userInfo.name;
        $('#display-name').value = userInfo.displayName;
        $('#picture-url').value = userInfo.picture;
      }
    } catch (error) {
      console.error(error);
      showSnackbar('Sign-in failed.');
      return false;
    };

  } else {
    // When signed out.
    try {
      user = await _fetch('/auth/userInfo');
    } catch {
      // Signed out
      displaySignin();
      return false;
    }
  }
  $('#dialog').close();
  icon.removeAttribute('icon');
  render(html`<img src="${user.picture}">`, icon);
  showSnackbar('You are signed in!');
  loading.stop();
  listCredentials();
  return true;
});

/**
 *  Collect advanced options and return a JSON object.
 * @returns WebAuthnRegistrationObject
 */
const collectOptions = (
  mode: 'registration' | 'authentication' = 'registration'
): WebAuthnRegistrationObject|WebAuthnAuthenticationObject => {
  // const specifyCredentials = $('#switch-rr').checked;
  const authenticatorAttachment = $('#attachment').value;
  const attestation = $('#conveyance').value;
  const residentKey = $('#resident-key').value;
  const userVerification = $('#user-verification').value;
  const credProps = $('#switch-cred-props').checked || undefined;
  const dpk = $('#switch-device-pub-key').checked || undefined;
  const customTimeout = parseInt($('#custom-timeout').value);
  // const abortTimeout = parseInt($('#abort-timeout').value);

  // Device Public Key extension
  // const devicePubKey = dpk ? { attestation } : undefined;
  const devicePubKey = dpk;

  // This is registration
  if (mode === 'registration') {
    const userInfo = localStorage.getItem('userInfo');
    const user = userInfo ? JSON.parse(userInfo) : undefined;

    return {
      attestation,
      authenticatorSelection: {
        authenticatorAttachment,
        userVerification,
        residentKey
      },
      extensions: { credProps, devicePubKey },
      customTimeout,
      user,
      // abortTimeout,
    } as WebAuthnRegistrationObject;
  
  // This is authentication
  } else {
    return {
      extensions: { devicePubKey },
      customTimeout,
      // abortTimeout,
    } as WebAuthnAuthenticationObject
  }
}

const collectCredentials = () => {
  const cards = document.querySelectorAll<HTMLDivElement>('#credentials .mdc-card__primary-action');

  const credentials: PublicKeyCredentialDescriptorJSON[] = [];

  // Traverse all checked credentials
  cards.forEach(card => {
    const checkbox = card.querySelector<Checkbox>('mwc-checkbox.credential-checkbox');
    if (checkbox?.checked) {
      // Look for all checked transport checkboxes
      const _transports = card.querySelectorAll<Checkbox>('mwc-checkbox.transport-checkbox[checked]');
      // Convert checkboxes into a list of transports
      const transports = Array.from(_transports).map(_transport => {
        const iconNode = <IconButton>_transport.previousElementSibling;
        const index = Object.values(transportIconMap).findIndex(_transport => _transport == iconNode.icon);
        return <AuthenticatorTransport>Object.keys(transportIconMap)[index];
      });
      credentials.push({
        id: card.id.substring(3), // Remove first `ID-`
        type: 'public-key',
        transports
      });
    }
  });

  return credentials;
};

/**
 *  Ripple on the specified credential card to indicate it's found.
 * @param credID 
 */
const rippleCard = (credID: string) => {
  const ripple = new MDCRipple($(`#${credID}`));
  ripple.activate();
  ripple.deactivate();
}

/**
 *  Serialize the User Verification Method Extension result
 * @param uvms 
 * @returns 
 */
function serializeUvm(uvms: any) {
  var uvmJson = [];
  for (let uvm of uvms) {
    const uvmEntry: any = {};
    uvmEntry.userVerificationMethod = uvm[0];
    uvmEntry.keyProtectionType = uvm[1];
    uvmEntry.atchuvmJsonerProtectionType = uvm[2];
    uvmJson.push(uvmEntry);
  }
  return uvmJson;
}

/**
 * Fetch and render the list of credentials.
 */
const listCredentials = async (): Promise<void> => {
  loading.start();
  try {
    const credentials = <any[]>await _fetch('/webauthn/getCredentials');
    loading.stop();
    render(credentials.map(cred => {
      cred.id = cred.credentialID.substr(0, 16);
      const extensions = cred.clientExtensionResults;
      const transports = cred.transports as string[];
      const authenticatorType = `${cred.user_verifying?'User Verifying ':''}`+
        `${cred.authenticatorAttachment==='platform'?'Platform ':
           cred.authenticatorAttachment==='cross-platform'?'Roaming ':''}Authenticator`;
      return html`
      <div class="mdc-card">
        <div class="mdc-card__primary-action" id="ID-${cred.credentialID}">
          <div class="card-title mdc-card__action-buttons">
            <div class="cred-title mdc-card__action-button">
              <mwc-formfield label="${cred.id}">
                <mwc-checkbox class="credential-checkbox" title="Check to exclude or allow this credential" checked></mwc-checkbox>
              </mwc-formfield>
            </div>
            <div class="mdc-card__action-icons">
              <mwc-icon-button @click="${removeCredential(cred.credentialID)}" icon="delete_forever" title="Removes this credential registration from the server"></mwc-icon>
            </div>
          </div>
          <div class="card-body">
            <dt>Authenticator Type</dt>
            <dd>${authenticatorType}</dd>
            <dt>Environment</dt>
            <dd>${cred.browser} / ${cred.os} / ${cred.platform}</dd>
            <dt>Transports</dt>
            <dd class="transports">
              ${!transports.length ? html`
              <span>N/A</span>
              ` : transports.map(transport => html`
              <mwc-formfield>
                <mwc-icon-button icon="${transportIconMap[transport]}"></mwc-icon-button>
                <mwc-checkbox class="transport-checkbox" title="Check to request '${transport}' as a transport on authentication." checked></mwc-checkbox>
              </mwc-formfield>
              `)}
            </dd>
            <dt>Enrolled</dt>
            <dd>${(new Date(cred.registered)).toLocaleString()}</dd>
            ${extensions?.uvm ? html`
            <dt>User Verification Method Extension</dt>
            <dd>${extensions.uvm}</dd>`:''}
            ${extensions?.credProps ? html`
            <dt>Credential Properties Extension</dt>
            <dd>${extensions.credProps.rk ? 'true' : 'false'}</dd>`:''}
            <dt>Public Key</dt>
            <dd>${cred.credentialPublicKey}</dd>
            <dt>Credential ID</dt>
            <dd>${cred.credentialID}</dd>
            <div class="mdc-card__ripple"></div>
          </div>
        </div>
      </div>
    `}), $('#credentials'));
    loading.stop();
    if (!$('#exclude-all-credentials').checked) {
      const cards = document.querySelectorAll<HTMLDivElement>('#credentials .mdc-card__primary-action');
      cards.forEach(card => {
        const checkbox = card.querySelector<Checkbox>('mwc-checkbox');
        if (checkbox) checkbox.checked = false;
      });
    }
  } catch (e) {
    console.error(e);
    showSnackbar('Loading credentials failed.');
    loading.stop();
  }
};

/**
 *  Register a new credential.
 * @param opts 
 */
const registerCredential = async (opts: WebAuthnRegistrationObject): Promise<any> => {
  // Fetch credential creation options from the server.
  const options: PublicKeyCredentialCreationOptionsJSON =
    await _fetch('/webauthn/registerRequest', opts);

  // Decode encoded parameters.
  const user = {
    ...options.user,
    id: base64url.decode(options.user.id)
  } as PublicKeyCredentialUserEntity;
  const challenge = base64url.decode(options.challenge);
  const _excludeCredentials: PublicKeyCredentialDescriptorJSON[] = collectCredentials();
  const excludeCredentials = _excludeCredentials.map(cred => {
    return {
      ...cred,
      id: base64url.decode(cred.id),
    } as PublicKeyCredentialDescriptor;
  });
  const decodedOptions = {
    ...options,
    user,
    challenge,
    excludeCredentials,
  } as PublicKeyCredentialCreationOptions;

  console.log('[CreationOptions]', decodedOptions);

  // Create a new attestation.
  const credential = await navigator.credentials.create({
    publicKey: decodedOptions
  }) as RegistrationCredential;

  // Encode the attestation.
  const rawId = base64url.encode(credential.rawId);
  const clientDataJSON = base64url.encode(credential.response.clientDataJSON);
  const attestationObject = base64url.encode(credential.response.attestationObject);
  const clientExtensionResults: any = {};

  // if `getClientExtensionResults()` is supported, serialize the result.
  if (credential.getClientExtensionResults) {
    const extensions = credential.getClientExtensionResults();
    if ('uvm' in extensions) {
      clientExtensionResults.uvm = serializeUvm(extensions.uvm);
    }
    if ('credProps' in extensions) {
      clientExtensionResults.credProps = extensions.credProps;
    }
    if ('devicePubKey' in extensions) {
      // @ts-ignore temporarily ignore the type error.
      clientExtensionResults.devicePubKey = base64url.encode(extensions.devicePubKey);
    }
  }
  let transports: any[] = [];

  // if `getTransports()` is supported, serialize the result.
  if (credential.response.getTransports) {
    transports = credential.response.getTransports();
  }

  const encodedCredential = {
    id: credential.id,
    rawId,
    response: {
      clientDataJSON,
      attestationObject
    },
    type: credential.type,
    transports,
    clientExtensionResults, 
  } as RegistrationCredentialJSON;

  console.log('[AttestationCredential]', encodedCredential);

  // Verify and store the attestation.
  await _fetch('/webauthn/registerResponse', encodedCredential);
};

/**
 *  Authenticate the user with a credential.
 * @param opts 
 * @returns 
 */
const authenticate = async (opts: WebAuthnAuthenticationObject): Promise<any> => {
  // Fetch the credential request options.
  const options: PublicKeyCredentialRequestOptionsJSON =
    await _fetch('/webauthn/authRequest', opts);

  // Decode encoded parameters.
  const challenge = base64url.decode(options.challenge);

  
  const _allowCredentials: PublicKeyCredentialDescriptorJSON[] =
    $('#empty-allow-credentials').checked ? [] : collectCredentials();
  const allowCredentials = _allowCredentials.map(cred => {
    return {
      ...cred,
      id: base64url.decode(cred.id),
    } as PublicKeyCredentialDescriptor;
  });
  const decodedOptions = {
    ...options,
    allowCredentials,
    challenge,
  } as PublicKeyCredentialRequestOptions;

  console.log('[RequestOptions]', decodedOptions);

  // Authenticate the user.
  const credential = await navigator.credentials.get({
    publicKey: decodedOptions
  }) as AuthenticationCredential;

  // Encode the credential.
  const rawId = base64url.encode(credential.rawId);
  const authenticatorData = base64url.encode(credential.response.authenticatorData);
  const clientDataJSON = base64url.encode(credential.response.clientDataJSON);
  const signature = base64url.encode(credential.response.signature);
  const userHandle = credential.response.userHandle ?
    base64url.encode(credential.response.userHandle) : undefined;

  const encodedCredential = {
    id: credential.id,
    rawId,
    response: {
      authenticatorData,
      clientDataJSON,
      signature,
      userHandle,
    },
    type: credential.type,
    clientExtensionResults: [],
  } as AuthenticationCredentialJSON;

  console.log('[AssertionCredential]', encodedCredential);

  // Verify and store the credential.
  return _fetch('/webauthn/authResponse', encodedCredential);
};

/**
 *  Remove a credential.
 * @param credId 
 * @returns 
 */
const removeCredential = (credId: string) => async () => {
  if (!confirm('Are you sure you want to remove this credential?')) {
    return;
  }
  try {
    loading.start();
    await _fetch('/webauthn/removeCredential', { credId });
    showSnackbar('The credential has been removed.');
    listCredentials();
  } catch (e) {
    console.error(e);
    showSnackbar('Removing the credential failed.');
  }
};

const onExcludeAllCredentials = (e: any): void => {
  const checked = !e.target.checked;
  const cards = document.querySelectorAll<HTMLDivElement>('#credentials .mdc-card__primary-action');
  cards.forEach(card => {
    const checkbox = card.querySelector<Checkbox>('mwc-checkbox');
    if (checkbox) checkbox.checked = checked;
  });
  e.target.checked = checked;
}

/**
 * When the user icon is clicked, show the User Info dialog.
 */
const onUserIconClicked = () => {
  const _userInfo = localStorage.getItem('userInfo');
  if (_userInfo) {
    const userInfo = JSON.parse(_userInfo);
    $('#username').value = userInfo.name;
    $('#display-name').value = userInfo.displayName;
    $('#picture-url').value = userInfo.picture;
  }
  $('#user-info').show();
}

/**
 * When "Save" button in the User Info dialog is clicked, update the user info.
 * @param e 
 */
const onUserInfoUpdate = (e: any): void => {
  const username = $('#username');
  const displayName = $('#display-name');
  const pictureUrl = $('#picture-url');

  let success = true;
  if (!username.checkValidity()) {
    username.reportValidity();
    success = false;
  }
  if (!displayName.checkValidity()) {
    displayName.reportValidity();
    success = false;
  }
  if(!pictureUrl.checkValidity()) {
    pictureUrl.reportValidity();
    success = false;
  }

  if (!success) {
    e.stopPropagation();
  } else {
    localStorage.setItem('userInfo', JSON.stringify({
      name: username.value,
      displayName: displayName.value,
      picture: pictureUrl.value,
    }));
  }
};

/**
 * Determine whether
 * `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`
 * function is available.
 */
const onISUVPAA = async (): Promise<void> => {
  if (window.PublicKeyCredential) {
    if (PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
      const result = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      if (result) {
        showSnackbar('User Verifying Platform Authenticator is *available*.');
      } else {
        showSnackbar('User Verifying Platform Authenticator is not available.');
      }
    } else {
      showSnackbar('IUVPAA function is not available.');
    }
  } else {
    showSnackbar('PublicKeyCredential is not availlable.');
  }
}

/**
 * On "Register New Credential" button click, invoke `registerCredential()`
 * function to register a new credential with advanced options.
 */
const onRegisterNewCredential = async (): Promise<void> => {
  loading.start();
  const opts = <WebAuthnRegistrationObject>collectOptions('registration');
  try {
    await registerCredential(opts);
    showSnackbar('A credential successfully registered!');
    listCredentials();
  } catch (e: any) {
    console.error(e);
    showSnackbar(e.message);
  } finally {
    loading.stop();
  }
};

/**
 * On "Register Platform Authenticator" button click, invoke
 * `registerCredential()` function to register a new credential with advanced
 * options overridden by `authenticatorAttachment == 'platform'` and
 * `userVerification = 'required'`.
 */
const onRegisterPlatformAuthenticator = async (): Promise<void> => {
  loading.start();
  const opts = <WebAuthnRegistrationObject>collectOptions('registration');
  opts.authenticatorSelection = opts.authenticatorSelection || {};
  opts.authenticatorSelection.authenticatorAttachment = 'platform';
  opts.authenticatorSelection.userVerification = 'required';
  try {
    await registerCredential(opts);
    showSnackbar('A credential successfully registered!');
    listCredentials();
  } catch (e: any) {
    console.error(e);
    showSnackbar(e.message);
  } finally {
    loading.stop();
  }
};

/**
 * On "Authenticate" button click, invoke `authenticate()` function to
 * authenticate the user.
 */
const onAuthenticate = async (): Promise<void> => {
  loading.start();
  const opts = <WebAuthnAuthenticationObject>collectOptions('authentication');
  try {
    const credential = await authenticate(opts);
    // Prepended `ID-` is necessary to avoid IDs start with a number.
    rippleCard(`ID-${credential.credentialID}`);
    showSnackbar('Authentication succeeded!');
  } catch (e: any) {
    console.error(e);
    showSnackbar(e.message);
  } finally {
    loading.stop();
  }
};

loading.start();

$('#isuvpaa-button').addEventListener('click', onISUVPAA);
$('#credential-button').addEventListener('click', onRegisterNewCredential);
$('#platform-button').addEventListener('click', onRegisterPlatformAuthenticator);
$('#authenticate-button').addEventListener('click', onAuthenticate);
$('#exclude-all-credentials').addEventListener('click', onExcludeAllCredentials);
$('#user-icon').addEventListener('click', onUserIconClicked);
$('#signout').addEventListener('click', onSignout);
$('#save-user-info').addEventListener('click', onUserInfoUpdate);
