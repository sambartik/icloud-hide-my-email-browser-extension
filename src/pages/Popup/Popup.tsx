import React, {
  useState,
  Dispatch,
  useEffect,
  ButtonHTMLAttributes,
  DetailedHTMLProps,
  ReactNode,
  ReactElement,
} from 'react';
import ICloudClient, {
  PremiumMailSettings,
  HmeEmail,
  ICloudClientSessionData,
  ICloudClientSession,
  EMPTY_SESSION_DATA,
} from '../../iCloudClient';
import './Popup.css';
import AuthCode from 'react-auth-code-input';
import { useBrowserStorageState } from '../../hooks';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faRefresh,
  faClipboard,
  faCheck,
  faList,
  faSignOut,
  IconDefinition,
  faPlus,
  faTrashAlt,
  faBan,
  faSearch,
  faInfoCircle,
} from '@fortawesome/free-solid-svg-icons';
import {
  LogInRequestData,
  LogInResponseData,
  Message,
  MessageType,
  sendMessageToTab,
} from '../../messages';
import {
  ErrorMessage,
  LoadingButton,
  Spinner,
  TitledComponent,
} from '../../commonComponents';
import {
  getBrowserStorageValue,
  POPUP_STATE_STORAGE_KEYS,
  SESSION_DATA_STORAGE_KEYS,
} from '../../storage';

import browser from 'webextension-polyfill';
import { setupWebRequestListeners } from '../../webRequestUtils';
import Fuse from 'fuse.js';
import isEqual from 'lodash.isequal';
import {
  PopupAction,
  PopupState,
  SignedInAction,
  SignedOutAction,
  STATE_MACHINE_TRANSITIONS,
  VerifiedAction,
  VerifiedAndManagingAction,
} from './stateMachine';
import { CONTEXT_MENU_ITEM_ID, SIGNED_OUT_CTA_COPY } from '../Background';

type TransitionCallback<T extends PopupAction> = (action: T) => void;

// The iCloud API requires the Origin and Referer HTTP headers of a request
// to be set to https://www.icloud.com.
// Since both of these header names are forbidden [0],
// the extension relies on the declarativeNetRequest API to inject/modify their
// values.
// However, Firefox does not currently support the declarativeNetRequest API [1].
// In firefox, the extension resorts to the legacy blocking webRequest API of MV2.
//
// Note that the webRequest listeners may also be constructed on runtimes
// that support declarativeNetRequest. This is fine, since these runtimes
// will just ignore the listeners due to the lack of the respective
// manifest permissions (webRequest and blockingWebRequest).
//
// [0] https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_header_name
// [1] https://bugzilla.mozilla.org/show_bug.cgi?id=1687755
if (browser.webRequest !== undefined) {
  setupWebRequestListeners();
}

const SignInForm = (props: {
  callback: TransitionCallback<SignedOutAction>;
  client: ICloudClient;
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    browser.runtime.onMessage.addListener(
      async (message: Message<LogInResponseData>) => {
        if (message.type !== MessageType.LogInResponse) {
          return;
        }
        setIsSubmitting(false);
        if (message.data.success) {
          await props.client.refreshSession();
          message.data.action && props.callback(message.data.action);
        } else {
          setError('Failed to sign in. Please try again.');
        }
      }
    );
  });

  const onFormSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(undefined);
    await browser.runtime.sendMessage({
      type: MessageType.LogInRequest,
      data: { email, password },
    } as Message<LogInRequestData>);
  };

  return (
    <TitledComponent title="Hide My Email" subtitle="Sign in to iCloud">
      <form
        className="space-y-3 text-base"
        action="#"
        method="POST"
        onSubmit={onFormSubmit}
      >
        <div className="rounded-md shadow-sm -space-y-px">
          <div>
            <label htmlFor="email-address" className="sr-only">
              Email address
            </label>
            <input
              id="email-address"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-400 text-gray-900 rounded-t-md focus:outline-none focus:ring-sky-400 focus:border-sky-400 focus:z-10 sm:text-sm"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isSubmitting}
              autoFocus // eslint-disable-line jsx-a11y/no-autofocus
            />
          </div>
          <div>
            <label htmlFor="password" className="sr-only">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-400 text-gray-900 rounded-b-md focus:outline-none focus:ring-sky-400 focus:border-sky-400 focus:z-10 sm:text-sm"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isSubmitting}
            />
          </div>
        </div>
        <div>
          <a
            href="https://iforgot.apple.com/password/verify/appleid"
            className="font-medium text-sky-400 hover:text-sky-500"
            target="_blank"
            rel="noreferrer"
          >
            Forgot your password?
          </a>
        </div>
        <div
          className="flex p-4 text-sm border text-gray-600 rounded-lg bg-gray-50"
          role="alert"
        >
          <FontAwesomeIcon icon={faInfoCircle} className="mr-2 mt-1" />
          <span className="sr-only">Info</span>
          <div>
            <span className="font-medium">
              The extension doesn&apos;t store your iCloud credentials.
            </span>{' '}
            It passes them directly to Apple without logging or utilizing them
            for any other purpose. Review the{' '}
            <a
              href="https://github.com/dedoussis/icloud-hide-my-email-browser-extension"
              className="text-sky-400 font-medium hover:text-sky-500"
              target="_blank"
              rel="noreferrer"
            >
              source code
            </a>
            .
          </div>
        </div>
        <div>
          <LoadingButton loading={isSubmitting}>Sign In</LoadingButton>
        </div>
        {error && <ErrorMessage>{error}</ErrorMessage>}
      </form>
    </TitledComponent>
  );
};

const TwoFaForm = (props: {
  callback: TransitionCallback<SignedInAction>;
  client: ICloudClient;
}) => {
  const [code, setCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const onFormSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(undefined);
    if (code.length === 6) {
      try {
        await props.client.verify2faCode(code);
        await props.client.trustDevice();
        await props.client.accountLogin();

        setIsSubmitting(false);

        props.callback('SUCCESSFUL_VERIFICATION');
      } catch (e) {
        setIsSubmitting(false);
        setError(
          '2FA failed. Please try entering the code again or sign-out and sign back in.'
        );
      }
    } else {
      setIsSubmitting(false);
      setError('Please fill in all of the 6 digits of the code.');
    }
  };
  return (
    <TitledComponent title="Hide My Email" subtitle="Enter the 2FA code">
      <form
        className="mt-8 space-y-3"
        action="#"
        method="POST"
        onSubmit={onFormSubmit}
      >
        <AuthCode
          onChange={(v) => setCode(v)}
          containerClassName="grid grid-cols-6 gap-2"
          inputClassName="col-auto h-14 text-center text-2xl mt-1 block w-full shadow-bg bg:text-bg border border-gray-300 placeholder-gray-400 focus:outline-none focus:ring-sky-400 focus:border-sky-400 rounded-md"
          allowedCharacters="numeric"
          disabled={isSubmitting}
          placeholder="."
        />
        <div>
          <LoadingButton loading={isSubmitting}>Verify</LoadingButton>
        </div>
        {error && <ErrorMessage>{error}</ErrorMessage>}
      </form>
      <div className="text-center mt-3">
        <SignOutButton {...props} />
      </div>
    </TitledComponent>
  );
};

const ReservationResult = (props: { hme: HmeEmail }) => {
  const onCopyToClipboardClick = async () => {
    await navigator.clipboard.writeText(props.hme.hme);
  };

  const onAutofillClick = async () => {
    await sendMessageToTab(MessageType.Autofill, props.hme.hme);
  };

  const btnClassName =
    'focus:outline-none text-white bg-green-700 hover:bg-green-800 focus:ring-4 focus:ring-green-300 font-medium rounded-lg text-sm px-5 py-2.5 block w-full';

  return (
    <div
      className="space-y-2 p-2 text-sm text-green-700 bg-green-100 rounded-lg"
      role="alert"
    >
      <p>
        <strong>{props.hme.hme}</strong> has successfully been reserved!
      </p>
      <div className={`grid grid-cols-2 gap-2`}>
        <button
          type="button"
          className={btnClassName}
          onClick={onCopyToClipboardClick}
        >
          <FontAwesomeIcon icon={faClipboard} className="mr-1" />
          Copy to clipboard
        </button>
        <button
          type="button"
          className={btnClassName}
          onClick={onAutofillClick}
        >
          <FontAwesomeIcon icon={faCheck} className="mr-1" />
          Autofill
        </button>
      </div>
    </div>
  );
};

const FooterButton = (
  props: { label: string; icon: IconDefinition } & DetailedHTMLProps<
    ButtonHTMLAttributes<HTMLButtonElement>,
    HTMLButtonElement
  >
) => {
  return (
    <button
      className="text-sky-400 hover:text-sky-500 focus:outline-sky-400"
      {...props}
    >
      <FontAwesomeIcon icon={props.icon} className="mr-1" />
      {props.label}
    </button>
  );
};

async function logOut(client: ICloudClient): Promise<void> {
  await client.logOut();
  await browser.contextMenus
    .update(CONTEXT_MENU_ITEM_ID, {
      title: SIGNED_OUT_CTA_COPY,
      enabled: false,
    })
    .catch(console.debug);
}

const SignOutButton = (props: {
  callback: TransitionCallback<'SUCCESSFUL_SIGN_OUT'>;
  client: ICloudClient;
}) => {
  return (
    <FooterButton
      className="text-sky-400 hover:text-sky-500 focus:outline-sky-400"
      onClick={async () => {
        await logOut(props.client);
        props.callback('SUCCESSFUL_SIGN_OUT');
      }}
      label="Sign out"
      icon={faSignOut}
    />
  );
};

const HmeGenerator = (props: {
  callback: TransitionCallback<VerifiedAction>;
  client: ICloudClient;
}) => {
  const [hmeEmail, setHmeEmail] = useState<string>();
  const [hmeError, setHmeError] = useState<string>();

  const [reservedHme, setReservedHme] = useState<HmeEmail>();
  const [reserveError, setReserveError] = useState<string>();

  const [isEmailRefreshSubmitting, setIsEmailRefreshSubmitting] =
    useState(false);
  const [isUseSubmitting, setIsUseSubmitting] = useState(false);
  const [tabHost, setTabHost] = useState('');
  const [fwdToEmail, setFwdToEmail] = useState<string>();

  const [note, setNote] = useState<string>();
  const [label, setLabel] = useState<string>();

  useEffect(() => {
    const fetchHmeList = async () => {
      setHmeError(undefined);
      try {
        const pms = new PremiumMailSettings(props.client);
        const result = await pms.listHme();
        setFwdToEmail(result.selectedForwardTo);
      } catch (e) {
        setHmeError(e.toString());
      }
    };

    fetchHmeList();
  }, [props.client]);

  useEffect(() => {
    const fetchHmeEmail = async () => {
      setHmeError(undefined);
      setIsEmailRefreshSubmitting(true);
      try {
        const pms = new PremiumMailSettings(props.client);
        setHmeEmail(await pms.generateHme());
      } catch (e) {
        setHmeError(e.toString());
      } finally {
        setIsEmailRefreshSubmitting(false);
      }
    };

    fetchHmeEmail();
  }, [props.client]);

  useEffect(() => {
    const getTabHost = async () => {
      const [tab] = await browser.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      const tabUrl = tab.url;
      if (tabUrl !== undefined) {
        const { hostname } = new URL(tabUrl);
        setTabHost(hostname);
        setLabel(hostname);
      }
    };

    getTabHost().catch(console.error);
  }, []);

  const onEmailRefreshClick = async () => {
    setIsEmailRefreshSubmitting(true);
    setReservedHme(undefined);
    setHmeError(undefined);
    setReserveError(undefined);

    try {
      const pms = new PremiumMailSettings(props.client);
      setHmeEmail(await pms.generateHme());
    } catch (e) {
      setHmeError(e.toString());
    }
    setIsEmailRefreshSubmitting(false);
  };

  const onUseSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsUseSubmitting(true);
    setReservedHme(undefined);
    setReserveError(undefined);

    if (hmeEmail !== undefined) {
      try {
        const pms = new PremiumMailSettings(props.client);
        setReservedHme(
          await pms.reserveHme(hmeEmail, label || tabHost, note || undefined)
        );
        setLabel(undefined);
        setNote(undefined);
      } catch (e) {
        setReserveError(e.toString());
      }
    }
    setIsUseSubmitting(false);
  };

  const isReservationFormDisabled =
    isEmailRefreshSubmitting || hmeEmail == reservedHme?.hme;

  const reservationFormInputClassName =
    'appearance-none rounded-md relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-400 text-gray-900 focus:outline-none focus:border-sky-400 focus:z-10 sm:text-sm';

  return (
    <TitledComponent
      title="Hide My Email"
      subtitle={`Create an address for '${tabHost}'`}
    >
      <div className="text-center space-y-1">
        <div>
          <span className="text-2xl">
            <button className="mr-2" onClick={onEmailRefreshClick}>
              <FontAwesomeIcon
                className="text-sky-400 hover:text-sky-500 align-text-bottom"
                icon={faRefresh}
                spin={isEmailRefreshSubmitting}
              />
            </button>
            {hmeEmail}
          </span>
          {fwdToEmail !== undefined && (
            <p className="text-gray-400">Forward to: {fwdToEmail}</p>
          )}
        </div>
        {hmeError && <ErrorMessage>{hmeError}</ErrorMessage>}
      </div>
      {hmeEmail && (
        <div className="space-y-3">
          <form
            className={`space-y-3 ${
              isReservationFormDisabled ? 'opacity-70' : ''
            }`}
            onSubmit={onUseSubmit}
          >
            <div>
              <label htmlFor="label" className="block font-medium">
                Label
              </label>
              <input
                id="label"
                placeholder={tabHost}
                required
                value={label || ''}
                onChange={(e) => setLabel(e.target.value)}
                className={reservationFormInputClassName}
                disabled={isReservationFormDisabled}
              />
            </div>
            <div>
              <label htmlFor="note" className="block font-medium">
                Note
              </label>
              <textarea
                id="note"
                rows={1}
                className={reservationFormInputClassName}
                placeholder="Make a note (optional)"
                value={note || ''}
                onChange={(e) => setNote(e.target.value)}
                disabled={isReservationFormDisabled}
              ></textarea>
            </div>
            <LoadingButton
              loading={isUseSubmitting}
              disabled={isReservationFormDisabled}
            >
              Use
            </LoadingButton>
            {reserveError && <ErrorMessage>{reserveError}</ErrorMessage>}
          </form>
          {reservedHme && <ReservationResult hme={reservedHme} />}
        </div>
      )}
      <div className="grid grid-cols-2">
        <div>
          <FooterButton
            onClick={() => props.callback('MANAGE')}
            icon={faList}
            label="Manage emails"
          />
        </div>
        <div className="text-right">
          <SignOutButton {...props} />
        </div>
      </div>
    </TitledComponent>
  );
};

const HmeDetails = (props: {
  hme: HmeEmail;
  client: ICloudClient;
  activationCallback: () => void;
  deletionCallback: () => void;
}) => {
  const [isActivateSubmitting, setIsActivateSubmitting] = useState(false);
  const [isDeleteSubmitting, setIsDeleteSubmitting] = useState(false);

  const [error, setError] = useState<string>();

  // Reset the error and the loaders when a new HME prop is passed to this component
  useEffect(() => {
    setError(undefined);
    setIsActivateSubmitting(false);
    setIsDeleteSubmitting(false);
  }, [props.hme]);

  const onActivationClick = async () => {
    setIsActivateSubmitting(true);
    const pms = new PremiumMailSettings(props.client);
    try {
      if (props.hme.isActive) {
        await pms.deactivateHme(props.hme.anonymousId);
      } else {
        await pms.reactivateHme(props.hme.anonymousId);
      }
      props.activationCallback();
    } catch (e) {
      setError(e.toString());
    } finally {
      setIsActivateSubmitting(false);
    }
  };

  const onDeletionClick = async () => {
    setIsDeleteSubmitting(true);
    const pms = new PremiumMailSettings(props.client);
    try {
      await pms.deleteHme(props.hme.anonymousId);
      props.deletionCallback();
    } catch (e) {
      setError(e.toString());
    } finally {
      setIsDeleteSubmitting(false);
    }
  };

  const onCopyClick = async () => {
    await navigator.clipboard.writeText(props.hme.hme);
  };

  const onAutofillClick = async () => {
    await sendMessageToTab(MessageType.Autofill, props.hme.hme);
  };

  const btnClassName =
    'w-full justify-center text-white focus:ring-4 focus:outline-none font-medium rounded-lg px-2 py-3 text-center inline-flex items-center';
  const labelClassName = 'font-bold';
  const valueClassName = 'text-gray-500 truncate';

  return (
    <div className="space-y-2">
      <div>
        <p className={labelClassName}>Email</p>
        <p title={props.hme.hme} className={valueClassName}>
          {props.hme.isActive || (
            <FontAwesomeIcon
              title="Deactivated"
              icon={faBan}
              className="text-red-500 mr-1"
            />
          )}
          {props.hme.hme}
        </p>
      </div>
      <div>
        <p className={labelClassName}>Label</p>
        <p title={props.hme.label} className={valueClassName}>
          {props.hme.label}
        </p>
      </div>
      <div>
        <p className={labelClassName}>Forward To</p>
        <p title={props.hme.forwardToEmail} className={valueClassName}>
          {props.hme.forwardToEmail}
        </p>
      </div>
      <div>
        <p className={labelClassName}>Created at</p>
        <p className={valueClassName}>
          {new Date(props.hme.createTimestamp).toLocaleString()}
        </p>
      </div>
      {props.hme.note && (
        <div>
          <p className={labelClassName}>Note</p>
          <p title={props.hme.note} className={valueClassName}>
            {props.hme.note}
          </p>
        </div>
      )}
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <div className="grid grid-cols-3 gap-2">
        <button
          title="Copy"
          className={`${btnClassName} bg-sky-400 hover:bg-sky-500 focus:ring-blue-300`}
          onClick={onCopyClick}
        >
          <FontAwesomeIcon icon={faClipboard} />
        </button>
        <button
          title="Autofill"
          className={`${btnClassName} bg-sky-400 hover:bg-sky-500 focus:ring-blue-300`}
          onClick={onAutofillClick}
        >
          <FontAwesomeIcon icon={faCheck} />
        </button>
        <LoadingButton
          title={props.hme.isActive ? 'Deactivate' : 'Reactivate'}
          className={`${btnClassName} ${
            props.hme.isActive
              ? 'bg-red-500 hover:bg-red-600 focus:ring-red-300'
              : 'bg-sky-400 hover:bg-sky-500 focus:ring-blue-300'
          }`}
          onClick={onActivationClick}
          loading={isActivateSubmitting}
        >
          <FontAwesomeIcon icon={props.hme.isActive ? faBan : faRefresh} />
        </LoadingButton>
        {!props.hme.isActive && (
          <LoadingButton
            title="Delete"
            className={`${btnClassName} bg-red-500 hover:bg-red-600 focus:ring-red-300 col-span-3`}
            onClick={onDeletionClick}
            loading={isDeleteSubmitting}
          >
            <FontAwesomeIcon icon={faTrashAlt} className="mr-1" /> Delete
          </LoadingButton>
        )}
      </div>
    </div>
  );
};

const searchHmeEmails = (
  searchPrompt: string,
  hmeEmails: HmeEmail[]
): HmeEmail[] | undefined => {
  if (!searchPrompt) {
    return undefined;
  }

  const searchEngine = new Fuse(hmeEmails, {
    keys: ['label', 'hme'],
    threshold: 0.4,
  });
  const searchResults = searchEngine.search(searchPrompt);
  return searchResults.map((result) => result.item);
};

const HmeManager = (props: {
  callback: TransitionCallback<VerifiedAndManagingAction>;
  client: ICloudClient;
}) => {
  const [fetchedHmeEmails, setFetchedHmeEmails] = useState<HmeEmail[]>();
  const [hmeEmailsError, setHmeEmailsError] = useState<string>();
  const [isFetching, setIsFetching] = useState(true);
  const [selectedHmeIdx, setSelectedHmeIdx] = useState(0);
  const [searchPrompt, setSearchPrompt] = useState<string>();

  useEffect(() => {
    const fetchHmeList = async () => {
      setHmeEmailsError(undefined);
      setIsFetching(true);
      try {
        const pms = new PremiumMailSettings(props.client);
        const result = await pms.listHme();
        setFetchedHmeEmails(
          result.hmeEmails.sort((a, b) => b.createTimestamp - a.createTimestamp)
        );
      } catch (e) {
        setHmeEmailsError(e.toString());
      } finally {
        setIsFetching(false);
      }
    };

    fetchHmeList();
  }, [props.client]);

  const activationCallbackFactory = (hmeEmail: HmeEmail) => () => {
    const newHmeEmail = { ...hmeEmail, isActive: !hmeEmail.isActive };
    setFetchedHmeEmails((prevFetchedHmeEmails) =>
      prevFetchedHmeEmails?.map((item) =>
        isEqual(item, hmeEmail) ? newHmeEmail : item
      )
    );
  };

  const deletionCallbackFactory = (hmeEmail: HmeEmail) => () => {
    setFetchedHmeEmails((prevFetchedHmeEmails) =>
      prevFetchedHmeEmails?.filter((item) => !isEqual(item, hmeEmail))
    );
  };

  const hmeListGrid = (fetchedHmeEmails: HmeEmail[]) => {
    const hmeEmails =
      searchHmeEmails(searchPrompt || '', fetchedHmeEmails) || fetchedHmeEmails;

    if (selectedHmeIdx >= hmeEmails.length) {
      setSelectedHmeIdx(hmeEmails.length - 1);
    }

    const selectedHmeEmail = hmeEmails[selectedHmeIdx];

    const searchBox = (
      <div className="relative p-2 rounded-tl-md bg-gray-100">
        <div className="absolute inset-y-0 flex items-center pl-3 pointer-events-none">
          <FontAwesomeIcon className="text-gray-400" icon={faSearch} />
        </div>
        <input
          type="search"
          className="pl-9 p-2 w-full rounded placeholder-gray-400 border border-gray-200 focus:outline-none focus:border-sky-400"
          placeholder="Search"
          aria-label="Search through your HideMyEmail addresses"
          onChange={(e) => {
            setSearchPrompt(e.target.value);
            setSelectedHmeIdx(0);
          }}
        />
      </div>
    );

    const btnBaseClassName =
      'p-2 w-full text-left border-b last:border-b-0 cursor-pointer truncate focus:outline-sky-400';
    const btnClassName = `${btnBaseClassName} hover:bg-gray-100`;
    const selectedBtnClassName = `${btnBaseClassName} text-white bg-sky-400 font-medium`;

    const labelList = hmeEmails.map((hme, idx) => (
      <button
        key={idx}
        aria-current={selectedHmeIdx === idx}
        type="button"
        className={idx === selectedHmeIdx ? selectedBtnClassName : btnClassName}
        onClick={() => setSelectedHmeIdx(idx)}
      >
        {hme.isActive ? (
          hme.label
        ) : (
          <div title="Deactivated">
            <FontAwesomeIcon icon={faBan} className="text-red-500 mr-1" />
            {hme.label}
          </div>
        )}
      </button>
    ));

    const noSearchResult = (
      <div className="p-3 break-words text-center text-gray-400">
        No results for &quot;{searchPrompt}&quot;
      </div>
    );

    return (
      <div className="grid grid-cols-2" style={{ height: 398 }}>
        <div className="overflow-y-auto text-sm rounded-l-md border border-gray-200">
          <div className="sticky top-0 border-b">{searchBox}</div>
          {hmeEmails.length === 0 && searchPrompt ? noSearchResult : labelList}
        </div>
        <div className="overflow-y-auto p-2 rounded-r-md border border-l-0 border-gray-200">
          {selectedHmeEmail && (
            <HmeDetails
              client={props.client}
              hme={selectedHmeEmail}
              activationCallback={activationCallbackFactory(selectedHmeEmail)}
              deletionCallback={deletionCallbackFactory(selectedHmeEmail)}
            />
          )}
        </div>
      </div>
    );
  };

  const emptyState = (
    <div className="text-center text-lg text-gray-400">
      There are no emails to list
    </div>
  );

  const resolveMainChildComponent = (): ReactNode => {
    if (isFetching) {
      return <Spinner />;
    }

    if (hmeEmailsError) {
      return <ErrorMessage>{hmeEmailsError}</ErrorMessage>;
    }

    if (!fetchedHmeEmails || fetchedHmeEmails.length === 0) {
      return emptyState;
    }

    return hmeListGrid(fetchedHmeEmails);
  };

  return (
    <TitledComponent
      title="Hide My Email"
      subtitle="Manage your HideMyEmail addresses"
    >
      {resolveMainChildComponent()}
      <div className="grid grid-cols-2">
        <div>
          <FooterButton
            onClick={() => props.callback('GENERATE')}
            icon={faPlus}
            label="Generate new email"
          />
        </div>
        <div className="text-right">
          <SignOutButton {...props} />
        </div>
      </div>
    </TitledComponent>
  );
};

const transitionToNextStateElement = (
  state: PopupState,
  setState: Dispatch<PopupState>,
  client: ICloudClient
): ReactElement => {
  switch (state) {
    case PopupState.SignedOut: {
      const callback = (action: SignedOutAction) =>
        setState(STATE_MACHINE_TRANSITIONS[state][action]);
      return <SignInForm callback={callback} client={client} />;
    }
    case PopupState.SignedIn: {
      const callback = (action: SignedInAction) =>
        setState(STATE_MACHINE_TRANSITIONS[state][action]);
      return <TwoFaForm callback={callback} client={client} />;
    }
    case PopupState.Verified: {
      const callback = (action: VerifiedAction) =>
        setState(STATE_MACHINE_TRANSITIONS[state][action]);
      return <HmeGenerator callback={callback} client={client} />;
    }
    case PopupState.VerifiedAndManaging: {
      const callback = (action: VerifiedAndManagingAction) =>
        setState(STATE_MACHINE_TRANSITIONS[state][action]);
      return <HmeManager callback={callback} client={client} />;
    }
    default: {
      const exhaustivenessCheck: never = state;
      throw new Error(`Unhandled PopupState case: ${exhaustivenessCheck}`);
    }
  }
};

const Popup = () => {
  const [state, setState] = useBrowserStorageState(
    POPUP_STATE_STORAGE_KEYS,
    PopupState.SignedOut
  );

  const [sessionData, setSessionData] =
    useBrowserStorageState<ICloudClientSessionData>(
      SESSION_DATA_STORAGE_KEYS,
      EMPTY_SESSION_DATA
    );

  const refreshSessionCallback = async (): Promise<void> => {
    const refreshedSessionData = (await getBrowserStorageValue(
      SESSION_DATA_STORAGE_KEYS
    )) as ICloudClientSessionData;
    await setSessionData(refreshedSessionData);
  };

  useEffect(() => {
    const validateSession = async () => {
      const session = new ICloudClientSession(sessionData, setSessionData);
      const client = new ICloudClient(session);

      if (client.authenticated) {
        try {
          await client.validateToken();
        } catch {
          await logOut(client);
          setState(PopupState.SignedOut);
        }
      }
    };

    validateSession();
  }, [sessionData, setSessionData, setState]);

  const session = new ICloudClientSession(
    sessionData,
    setSessionData,
    refreshSessionCallback
  );
  const client = new ICloudClient(session);

  return (
    <div className="min-h-full flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {transitionToNextStateElement(state, setState, client)}
      </div>
    </div>
  );
};

export default Popup;
