import React from 'react';

export default function ConnectionStatus({ error }) {
  if (!error) return null;
  return (
    <div className="banner-error">
      Connection Lost: Unable to poll gateway metrics. Retrying...
    </div>
  );
}
