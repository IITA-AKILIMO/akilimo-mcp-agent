import React, { useState } from 'react';
import type { FarmStore } from '../mcp/farmProfile';

// The line at the top of a form that fills in what the farmer already told us for this country, and lets them stop that
// or erase it. Where it is kept is said plainly: their account (other devices see it too) or this browser.
export const RememberBar: React.FC<{
  countryName: string;
  store: FarmStore;
  hasProfile: boolean;
  remember: boolean;
  onRemember: (on: boolean) => void;
  onForget: () => Promise<void>;
}> = ({ countryName, store, hasProfile, remember, onRemember, onForget }) => {
  const [busy, setBusy] = useState(false);
  return (
    <div className="small text-body-secondary d-flex align-items-center flex-wrap gap-x-3 gap-2 mb-3">
      <div className="form-check mb-0">
        <input id="farm-remember" className="form-check-input" type="checkbox" checked={remember} onChange={e => onRemember(e.target.checked)} />
        <label className="form-check-label" htmlFor="farm-remember">
          Remember my farm details for {countryName} ({store === 'account' ? 'in my account' : 'on this device only'})
        </label>
      </div>
      {hasProfile && (
        <>
          <span>Saved details are filled in below.</span>
          <button type="button" className="btn btn-link btn-sm p-0 text-danger" disabled={busy}
            onClick={async () => { setBusy(true); try { await onForget(); } finally { setBusy(false); } }}>
            Forget them
          </button>
        </>
      )}
    </div>
  );
};
