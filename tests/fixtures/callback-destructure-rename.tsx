import React from "react";

interface CallbackDestructureRenameProps {
  name?: string;
}

const CallbackDestructureRenameEmail = ({ name }: CallbackDestructureRenameProps) => {
  const users = [{ name: "a" }, { name: "b" }];

  return (
    <div>
      {users.map(({ name: n }) => (
        <p key={n}>{name ?? "fallback-from-callback"}</p>
      ))}
    </div>
  );
};

export default CallbackDestructureRenameEmail;
