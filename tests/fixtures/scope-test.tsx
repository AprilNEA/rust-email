import React from "react";

interface ScopeTestProps {
  name?: string;
  count?: number;
}

// Helper function that uses `name` and `count` with ?? — must NOT pollute schema
function formatLabel(name: string | undefined) {
  return name ?? "default-label";
}

function computeTotal(count: number | undefined) {
  return count ?? 0;
}

// Also a helper that uses property access on an unrelated object
const config = { name: "system", count: 99 };
function getConfig() {
  return config.name ?? "fallback-config";
}

// The actual component — destructured props
const ScopeTestEmail = ({ name, count }: ScopeTestProps) => {
  // These are the REAL prop fallbacks
  const displayName = name ?? "friend";
  const displayCount = count ?? 42;

  return (
    <div>
      <p>Hello {displayName}</p>
      <p>Count: {displayCount}</p>
      <p>Label: {formatLabel(name)}</p>
      <p>Total: {computeTotal(count)}</p>
    </div>
  );
};

export default ScopeTestEmail;
