"use client";
import * as React from "react";

type Props = React.InputHTMLAttributes<HTMLInputElement>;

const CallerInput = React.forwardRef<HTMLInputElement, Props>(
  function CallerInput({ className = "", ...rest }, ref) {
    return <input ref={ref} {...rest} className={`crm-input ${className}`.trim()} />;
  },
);

export default CallerInput;
