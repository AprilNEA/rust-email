import React from "react";

interface PropAccessTestProps {
  currency?: string;
  greeting?: string;
}

// Unrelated object with same-named property
const defaults = { currency: "EUR", greeting: "Hey" };

function getDefaults() {
  // Must NOT be picked up as a prop fallback
  return defaults.currency ?? "GBP";
}

// Component uses `props.xxx` form (non-destructured)
const PropAccessEmail = (props: PropAccessTestProps) => {
  return (
    <div>
      <p>{props.currency ?? "US$"}</p>
      <p>{props.greeting ?? "Hello"}</p>
      <p>{getDefaults()}</p>
    </div>
  );
};

export default PropAccessEmail;
