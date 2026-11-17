export function SfIcon({
  name,
  size = 15,
  className = '',
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className ? `sf-icon ${className}` : 'sf-icon'}
      width={size}
      height={size}
      aria-hidden="true"
    >
      <use href={`#${name}`} />
    </svg>
  );
}

export function SfIconSprite() {
  return (
    <svg style={{ display: 'none' }} aria-hidden="true">
      <symbol id="sf-archipelago" viewBox="0 0 20 20">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 12.5c2.2 1.2 4.8 1.2 7 0 2.2-1.2 4.8-1.2 7 0M5.5 16c1.6.8 3.4.8 5 0 1.6-.8 3.4-.8 5 0M10 4l2.8 5.2H7.2L10 4Z"
        />
      </symbol>
      <symbol id="sf-search" viewBox="0 0 20 20">
        <circle cx="8.8" cy="8.8" r="5.3" fill="none" stroke="currentColor" strokeWidth="1.65" />
        <path
          d="m12.8 12.8 3.7 3.7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
        />
      </symbol>
      <symbol id="sf-arrow-right" viewBox="0 0 20 20">
        <path
          d="M4.5 10h11M11 5.5 15.5 10 11 14.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </symbol>
      <symbol id="sf-arrow-left" viewBox="0 0 20 20">
        <path
          d="M15.5 10h-11M9 5.5 4.5 10 9 14.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </symbol>
      <symbol id="sf-arrow-up-right" viewBox="0 0 20 20">
        <path
          d="M6 14 14 6M7.5 6H14v6.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </symbol>
      <symbol id="sf-folder" viewBox="0 0 20 20">
        <path
          d="M2.8 5.8a1.8 1.8 0 0 1 1.8-1.8h3.1l1.7 1.8h6a1.8 1.8 0 0 1 1.8 1.8v6.8a1.8 1.8 0 0 1-1.8 1.8H4.6a1.8 1.8 0 0 1-1.8-1.8V5.8Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </symbol>
      <symbol id="sf-grid" viewBox="0 0 20 20">
        <rect x="3.2" y="3.2" width="5.6" height="5.6" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <rect x="11.2" y="3.2" width="5.6" height="5.6" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <rect x="3.2" y="11.2" width="5.6" height="5.6" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <rect x="11.2" y="11.2" width="5.6" height="5.6" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </symbol>
      <symbol id="sf-people" viewBox="0 0 20 20">
        <circle cx="7.5" cy="7" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M3.2 15.5c.6-2.4 2.3-3.7 4.3-3.7s3.7 1.3 4.3 3.7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <circle cx="13.4" cy="7.6" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M12.5 12.2c1.7.1 3.1 1.1 3.7 3.1"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </symbol>
      <symbol id="sf-walk" viewBox="0 0 20 20">
        <circle cx="10.5" cy="4.2" r="1.7" fill="currentColor" />
        <path
          d="M7.2 9.5 9.8 7l2.2 2.2 2.3 1.1M10 7.4l-.8 4.4-2.5 4.4M9.5 11.8l2.6 2.1.9 2.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </symbol>
      <symbol id="sf-sun" viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.65" />
        <path
          d="M10 2.6v1.8M10 15.6v1.8M2.6 10h1.8M15.6 10h1.8M4.8 4.8l1.3 1.3M13.9 13.9l1.3 1.3M15.2 4.8l-1.3 1.3M6.1 13.9l-1.3 1.3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
        />
      </symbol>
      <symbol id="sf-sunset" viewBox="0 0 20 20">
        <path
          d="M3 14.2h14M5.5 17h9M6.2 14.2a3.8 3.8 0 0 1 7.6 0M10 4.5v2.2M4.8 7.5l1.5 1.5M15.2 7.5l-1.5 1.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
        />
      </symbol>
      <symbol id="sf-moon" viewBox="0 0 20 20">
        <path
          d="M14.8 12.7A6 6 0 0 1 7.3 5.2a6 6 0 1 0 7.5 7.5Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinejoin="round"
        />
      </symbol>
      <symbol id="sf-speaker" viewBox="0 0 20 20">
        <path
          d="M4 8.2h2.8L10.5 5v10l-3.7-3.2H4a.8.8 0 0 1-.8-.8V9a.8.8 0 0 1 .8-.8Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path
          d="M13.2 7.6a3.4 3.4 0 0 1 0 4.8M15.3 5.6a6.2 6.2 0 0 1 0 8.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </symbol>
      <symbol id="sf-speaker-mute" viewBox="0 0 20 20">
        <path
          d="M4 8.2h2.8L10.5 5v10l-3.7-3.2H4a.8.8 0 0 1-.8-.8V9a.8.8 0 0 1 .8-.8ZM13.2 8l3.6 4M16.8 8l-3.6 4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </symbol>
      <symbol id="sf-question" viewBox="0 0 20 20">
        <path
          d="M7.8 7.4a2.3 2.3 0 1 1 3.4 2c-.9.5-1.2 1-1.2 1.9M10 14.4h.01"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
      </symbol>
      <symbol id="sf-close" viewBox="0 0 20 20">
        <path
          d="m6 6 8 8M14 6l-8 8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </symbol>
      <symbol id="sf-gate" viewBox="0 0 20 20">
        <path
          d="M3.2 6.2h13.6M4.8 4.2h10.4M5.5 6.2v10M14.5 6.2v10M8.5 9.2v7M11.5 9.2v7M3.8 9.2h12.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </symbol>
      <symbol id="sf-shuffle" viewBox="0 0 20 20">
        <path
          d="M3.5 6.5h3.2c2.2 0 3.6 7 6.2 7h3.6M14.2 11.2l2.3 2.3-2.3 2.3M3.5 13.5h3.2c1.1 0 2-.9 2.7-2.2M16.5 6.5h-3.6c-1 0-1.8.7-2.5 1.8M14.2 4.2l2.3 2.3-2.3 2.3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </symbol>
      <symbol id="sf-viewfinder" viewBox="0 0 20 20">
        <path
          d="M3.5 7V5.2A1.7 1.7 0 0 1 5.2 3.5H7M13 3.5h1.8A1.7 1.7 0 0 1 16.5 5.2V7M16.5 13v1.8a1.7 1.7 0 0 1-1.7 1.7H13M7 16.5H5.2A1.7 1.7 0 0 1 3.5 14.8V13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
        />
        <circle cx="10" cy="10" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.65" />
      </symbol>
      <symbol id="sf-branch" viewBox="0 0 20 20">
        <circle cx="6" cy="5.5" r="1.9" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="6" cy="14.5" r="1.9" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="14" cy="7.5" r="1.9" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M6 7.4v5.2M14 9.4c0 2.6-2.2 3.1-8 3.1"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </symbol>
      <symbol id="sf-copy" viewBox="0 0 20 20">
        <rect x="7.2" y="7.2" width="8.6" height="8.6" rx="1.8" fill="none" stroke="currentColor" strokeWidth="1.55" />
        <path
          d="M12.8 7.2V5.6a1.6 1.6 0 0 0-1.6-1.6H5.6A1.6 1.6 0 0 0 4 5.6v5.6a1.6 1.6 0 0 0 1.6 1.6h1.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.55"
        />
      </symbol>
      <symbol id="sf-chevron-right" viewBox="0 0 20 20">
        <path
          d="m7.5 5 5 5-5 5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </symbol>
      <symbol id="sf-sparkles" viewBox="0 0 20 20">
        <path
          d="m10 3.2 1.4 4.1 4.1 1.4-4.1 1.4-1.4 4.1-1.4-4.1-4.1-1.4 4.1-1.4L10 3.2ZM15.2 12.6l.6 1.8 1.8.6-1.8.6-.6 1.8-.6-1.8-1.8-.6 1.8-.6.6-1.8Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.45"
          strokeLinejoin="round"
        />
      </symbol>
      <symbol id="sf-refresh" viewBox="0 0 20 20">
        <path
          d="M15.8 9.2A6 6 0 1 0 14.5 14M16 5.2v4h-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </symbol>
      <symbol id="sf-share" viewBox="0 0 20 20">
        <path
          d="M10 3.2v9.2M6.8 6.2 10 3l3.2 3.2M5.2 10.5v4.7a1.8 1.8 0 0 0 1.8 1.8h6a1.8 1.8 0 0 0 1.8-1.8v-4.7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </symbol>
    </svg>
  );
}
