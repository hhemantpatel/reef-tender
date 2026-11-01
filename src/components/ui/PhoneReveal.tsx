import React, { useState } from 'react';
import { decodePhone } from '../../data/cvData';

/** Shows a "Show phone number" button; the number is decoded only after a click. */
export const PhoneReveal: React.FC<{ linkClassName?: string; buttonClassName?: string }> = ({
  linkClassName,
  buttonClassName,
}) => {
  const [phone, setPhone] = useState<string | null>(null);

  if (phone) {
    return (
      <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className={linkClassName}>
        {phone}
      </a>
    );
  }
  return (
    <button type="button" onClick={() => setPhone(decodePhone())} className={buttonClassName}>
      Show phone number
    </button>
  );
};
