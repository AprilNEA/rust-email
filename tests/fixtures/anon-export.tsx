import React from "react";

interface AnonExportProps {
  name?: string;
  greeting?: string;
}

export default ({ name, greeting }: AnonExportProps) => {
  return (
    <div>
      <p>{name ?? "world"}</p>
      <p>{greeting ?? "Hi"}</p>
    </div>
  );
};
