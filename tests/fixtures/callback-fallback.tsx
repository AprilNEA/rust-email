import React from "react";

interface CallbackFallbackProps {
  name?: string;
  label?: string;
}

const CallbackFallbackEmail = ({ name, label }: CallbackFallbackProps) => {
  const items = ["a", "b"];

  return (
    <div>
      {items.map((item) => (
        <p key={item}>{name ?? "fallback-in-callback"}</p>
      ))}
      <p>{label ?? "direct-fallback"}</p>
    </div>
  );
};

export default CallbackFallbackEmail;
