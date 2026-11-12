import { Link } from 'react-router-dom';
import { APP_NAME } from '../../config';

export function Logo({ hideNameOnMobile = false }: { hideNameOnMobile?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label={`${APP_NAME} home`}>
      <svg width="26" height="26" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="30" fill="#2a2019" />
        <circle cx="32" cy="32" r="22" fill="none" stroke="#4a3b30" strokeWidth="2" />
        <circle cx="32" cy="32" r="16" fill="none" stroke="#4a3b30" strokeWidth="2" />
        <circle cx="32" cy="32" r="10" fill="#c8482c" />
        <circle cx="32" cy="32" r="2.5" fill="#f8f1e4" />
      </svg>
      <span className={`eyebrow !text-xs ${hideNameOnMobile ? 'hidden sm:inline' : ''}`}>{APP_NAME}</span>
    </Link>
  );
}
