import React from "react";

interface InlineHelperProps {
  name?: string;
  count?: number;
}

const InlineHelperEmail = ({ name, count }: InlineHelperProps) => {
  // Inline helper with same-named parameter — must NOT pollute schema
  function helper(name: string | undefined) {
    return name ?? "FROM_HELPER_PARAM";
  }

  // Another inline helper using arrow syntax
  const formatCount = (count: number | undefined) => count ?? 999;

  // The REAL component-level fallbacks
  return (
    <div>
      <p>{name ?? "FROM_COMPONENT"}</p>
      <p>{String(count ?? 42)}</p>
      <p>{helper(name)}</p>
      <p>{String(formatCount(count))}</p>
    </div>
  );
};

export default InlineHelperEmail;
