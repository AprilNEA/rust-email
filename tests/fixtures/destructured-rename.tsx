import React from "react";

interface RenameProps {
  name?: string;
  emailAddress?: string;
}

const RenameEmail = ({ name: displayName, emailAddress: addr }: RenameProps) => {
  return (
    <div>
      <p>{displayName ?? "friend"}</p>
      <p>{addr ?? "no-reply@example.com"}</p>
    </div>
  );
};

export default RenameEmail;
