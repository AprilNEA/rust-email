import React, { memo } from "react";

interface MemoWrappedProps {
  title?: string;
  count?: number;
}

const MemoWrappedEmail = memo(({ title, count }: MemoWrappedProps) => {
  return (
    <div>
      <h1>{title ?? "Untitled"}</h1>
      <p>Count: {count ?? 0}</p>
    </div>
  );
});

export default MemoWrappedEmail;
