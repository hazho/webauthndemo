import { html, render, $, showSnackbar, loading, _fetch } from './util';
import { base64url } from './base64url';
import { MDCRipple } from '@material/ripple';
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import * as firebaseui from 'firebaseui';
import {
  RegistrationCredential,
  RegistrationCredentialJSON,
  AuthenticationCredential,
  AuthenticationCredentialJSON,
  PublicKeyCredentialCreationOptions,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptions,
  PublicKeyCredentialRequestOptionsJSON
} from '@simplewebauthn/typescript-types';

interface WebAuthnRequestObject {
  attestation: AttestationConveyancePreference
  authenticatorSelection: {
    authenticatorAttachment: AuthenticatorAttachment
    userVerification: UserVerificationRequirement
    residentKey: ResidentKeyRequirement
  },
  extensions: {
    uvm?: boolean
    appId?: boolean
    appidExclude?: string
    credProps?: boolean
  }
  excludeCredentials: boolean
  emptyAllowCredentials: boolean
  customTimeout?: number
  abortTimeout?: number
}

initializeApp({
  apiKey: "AIzaSyCBxWRgC7bxaek2mwH-RjxhF3mJY2gPBxI",
  authDomain: "webauthndemo-v2.firebaseapp.com",
  projectId: "webauthndemo-v2",
  storageBucket: "webauthndemo-v2.appspot.com",
  messagingSenderId: "988350542501",
  appId: "1:988350542501:web:778af145915d7ad05d134c"
});

const auth = getAuth();

const ui = new firebaseui.auth.AuthUI(auth);

const collectOptions = (): WebAuthnRequestObject => {
  const excludeCredentials = $('#switch-rr').checked;
  const emptyAllowCredentials = $('#switch-ec').checked;
  const authenticatorAttachment = $('#attachment').value;
  const attestation = $('#conveyance').value;
  const residentKey = $('#resident-key').value;
  const userVerification = $('#user-verification').value;
  const uvm = $('#switch-uvm').checked;
  const credProps = $('#switch-cred-props').checked;
  const customTimeout = parseInt($('#custom-timeout').value);
  // const abortTimeout = parseInt($('#abort-timeout').value);

  const options = {
    attestation,
    authenticatorSelection: {
      authenticatorAttachment,
      userVerification,
      residentKey
    },
    extensions: { uvm, credProps },
    excludeCredentials,
    emptyAllowCredentials,
    customTimeout,
    // abortTimeout,
  } as WebAuthnRequestObject;

  return options;
}

const rippleCard = (credID: string) => {
  const ripple = new MDCRipple($(`#ID-${credID}`));
  ripple.activate();
  ripple.deactivate();
}

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

const listCredentials = async (): Promise<void> => {
  loading.start();
  try {
    const credentials = <any[]>await _fetch('/webauthn/getCredentials');
    loading.stop();
    render(credentials.map(cred => {
      cred.id = cred.credentialID.substr(0, 16);
      const extensions = cred.clientExtensionResults;
      return html`
      <div class="mdc-card">
        <div class="mdc-card__primary-action" id="ID-${cred.credentialID}">
          <div class="card-title mdc-card__action-buttons">
            <span class="cred-title">${cred.id}</span>
            <!-- <mwc-formfield label="${cred.id}" class="mdc-card__action-button">
              <mwc-switch id="switch-${cred.credentialID}" selected></mwc-switch>  
            </mwc-formfield> -->
            <div class="mdc-card__action-icons">
              <mwc-icon-button @click="${removeCredential(cred.credentialID)}" icon="delete_forever" title="Removes this credential registration from the server"></mwc-icon>
            </div>
          </div>
          <div class="card-body">
            <dt>Enrolled</dt>
            <dd>${(new Date(cred.registered)).toLocaleString()}</dd>
            <dt>Public Key</dt>
            <dd>${cred.credentialPublicKey}</dd>
            <dt>Key Handle</dt>
            <dd>${cred.credentialID}</dd>
            <dt>Transports</dt>
            <dd class="transports">
              ${['usb', 'nfc', 'ble', 'internal', 'cable'].map((transport, index) => html`
              <mwc-formfield label="${transport}">
                <mwc-checkbox ?checked="${cred.transports.includes(transport)}" disabled></mwc-checkbox>
              </mwc-formfield>
              `)}
            </dd>
            ${extensions?.uvm ? html`
            <dt>User Verification Method Extension</dt>
            <dd>${extensions.uvm}</dd>`:''}
            ${extensions?.credProps ? html`
            <dt>Credential Properties Extension</dt>
            <dd>${extensions.credProps.rk ? 'true' : 'false'}</dd>`:''}
            <div class="mdc-card__ripple"></div>
          </div>
        </div>
      </div>
    `}), $('#credentials'));
    loading.stop();
  } catch (e) {
    console.error(e);
    showSnackbar('Loading credentials failed.');
    loading.stop();
  }
};

const registerCredential = async (opts: WebAuthnRequestObject): Promise<any> => {
  const options: PublicKeyCredentialCreationOptionsJSON =
    await _fetch('/webauthn/registerRequest', opts);
  const user = {
    ...options.user,
    id: base64url.decode(options.user.id)
  } as PublicKeyCredentialUserEntity;
  const challenge = base64url.decode(options.challenge);
  const excludeCredentials: PublicKeyCredentialDescriptor[] = [];
  if (options.excludeCredentials) {
    options.excludeCredentials.map(cred => {
      excludeCredentials.push({
        ...cred,
        id: base64url.decode(cred.id),
      });
    });
  }
  const decodedOptions = {
    ...options,
    user,
    challenge,
    excludeCredentials,
  } as PublicKeyCredentialCreationOptions;

  console.log('[CreationOptions]', decodedOptions);

  const credential = await navigator.credentials.create({
    publicKey: decodedOptions
  }) as RegistrationCredential;

  const rawId = base64url.encode(credential.rawId);
  const clientDataJSON = base64url.encode(credential.response.clientDataJSON);
  const attestationObject = base64url.encode(credential.response.attestationObject);
  const clientExtensionResults: any = {};

  // if `getClientExtensionResults()` is supported:
  if (credential.getClientExtensionResults) {
    const extensions = credential.getClientExtensionResults();
    if ('uvm' in extensions) {
      clientExtensionResults.uvm = serializeUvm(extensions.uvm);
    }
    if ('credProps' in extensions) {
      clientExtensionResults.credProps = extensions.credProps;
    }
  }
  let transports: any[] = [];

  // if `getTransports()` is supported:
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

  await _fetch('/webauthn/registerResponse', encodedCredential);
};

const authenticate = async (opts: WebAuthnRequestObject): Promise<any> => {
  const options: PublicKeyCredentialRequestOptionsJSON =
    await _fetch('/webauthn/authRequest', opts);
  const challenge = base64url.decode(options.challenge);
  const allowCredentials: PublicKeyCredentialDescriptor[] = [];
  if (options.allowCredentials) {
    options.allowCredentials.map(cred => {
      allowCredentials.push({
        ...cred,
        id: base64url.decode(cred.id),
      });
    });
  }
  const decodedOptions = {
    ...options,
    allowCredentials,
    challenge,
  } as PublicKeyCredentialRequestOptions;

  console.log('[RequestOptions]', decodedOptions);

  const credential = await navigator.credentials.get({
    publicKey: decodedOptions
  }) as AuthenticationCredential;

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

  return _fetch('/webauthn/authResponse', encodedCredential);
};

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

const icon = $('#user-icon');

const verifyIdToken = (authResult: any): boolean => {
  authResult.user.getIdToken()
    .then((id_token: string) => _fetch('/auth/verify', { id_token }))
    .then((res: any) => {
      if (!res.status) showSnackbar('Sign-in failed.');
    });
  return false;
}

const displaySignin = () => {
  loading.start();
  ui.start('#firebaseui-auth-container', {
    signInOptions: [
      GoogleAuthProvider.PROVIDER_ID
    ],
    signInFlow: 'popup',
    callbacks: {
      signInSuccessWithAuthResult: verifyIdToken
    }
  });
  $('#dialog').show();
};

const signedIn = (user: User) => {
  $('#dialog').close();
  icon.removeAttribute('icon');
  render(html`<img src="${user.photoURL}">`, icon);
  showSnackbar('You are signed in!');
  loading.stop();
  listCredentials();
}

const signout = async () => {
  if (!confirm('Do you want to sign out?')) {
    return;
  }
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
onAuthStateChanged(auth, user => {
  if (!window.PublicKeyCredential) {
    render(html`
      <p>Your browser does not support WebAuthn.</p>
    `, $('#firebaseui-auth-container'));
    $('#dialog').show();
    return;
  }
  if (user) {
    // Signed in
    signedIn(user);
  } else {
    // Signed out
    displaySignin();
  }
});

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
  const opts = collectOptions();
  try {
    await registerCredential(opts);
    showSnackbar('A credential successfully registered!');
    listCredentials();
  } catch (e: any) {
    console.error(e);
    showSnackbar('Registering a credential failed');
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
  const opts = collectOptions();
  opts.authenticatorSelection.authenticatorAttachment = 'platform';
  opts.authenticatorSelection.userVerification = 'required';
  try {
    await registerCredential(opts);
    showSnackbar('A credential successfully registered!');
    listCredentials();
  } catch (e: any) {
    console.error(e);
    showSnackbar('Registering a credential failed');
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
  const opts = collectOptions();
  try {
    const credential = await authenticate(opts);
    rippleCard(credential.credentialID);
    showSnackbar('Authentication succeeded!');
  } catch (e: any) {
    console.error(e);
    showSnackbar('Authentication failed');
  } finally {
    loading.stop();
  }
};

$('#user-icon').addEventListener('click', signout);
$('#isuvpaa-button').addEventListener('click', onISUVPAA);
$('#credential-button').addEventListener('click', onRegisterNewCredential);
$('#platform-button').addEventListener('click', onRegisterPlatformAuthenticator);
$('#authenticate-button').addEventListener('click', onAuthenticate);
