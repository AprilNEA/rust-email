import React from "react";

interface CallbackPropsDestructureRenameProps {
  name?: string;
}

const CallbackPropsDestructureRenameEmail = (
  props: CallbackPropsDestructureRenameProps,
) => {
  const rows = [{ props: { id: 1 } }, { props: { id: 2 } }];

  return (
    <div>
      {rows.map(({ props: p }) => (
        <p key={String(p.id)}>{props.name ?? "fallback-from-props-callback"}</p>
      ))}
    </div>
  );
};

export default CallbackPropsDestructureRenameEmail;
