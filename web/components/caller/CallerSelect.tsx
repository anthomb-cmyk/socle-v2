"use client";
import * as React from "react";

type Props = React.SelectHTMLAttributes<HTMLSelectElement>;

const CallerSelect = React.forwardRef<HTMLSelectElement, Props>(
  function CallerSelect({ className = "", ...rest }, ref) {
    return <select ref={ref} {...rest} className={`crm-select ${className}`.trim()} />;
  },
);

export default CallerSelect;
