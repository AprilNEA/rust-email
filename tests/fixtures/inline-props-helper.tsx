import React from "react";

interface InlinePropsHelperProps {
  name?: string;
  age?: number;
}

const InlinePropsHelperEmail = (props: InlinePropsHelperProps) => {
  // Nested helper that also has a parameter named `props` — must NOT pollute
  function nested(props: { name?: string }) {
    return props.name ?? "FROM_NESTED_PROPS";
  }

  // Arrow helper with `props` param
  const another = (props: { age?: number }) => props.age ?? 999;

  return (
    <div>
      <p>{props.name ?? "FROM_COMPONENT_PROPS"}</p>
      <p>{String(props.age ?? 25)}</p>
      <p>{nested({ name: props.name })}</p>
      <p>{String(another({ age: props.age }))}</p>
    </div>
  );
};

export default InlinePropsHelperEmail;
