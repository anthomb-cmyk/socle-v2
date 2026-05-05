"use client";
import * as React from "react";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">;

const CallerDateTimeInput = React.forwardRef<HTMLInputElement, Props>(
  function CallerDateTimeInput({ className = "", ...rest }, ref) {
    return (
      <input
        ref={ref}
        type="datetime-local"
        {...rest}
        className={`crm-datetime ${className}`.trim()}
      />
    );
  },
);

export default CallerDateTimeInput;
