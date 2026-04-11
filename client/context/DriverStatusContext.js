import React, { createContext, useContext } from 'react';

const noop = async () => null;
const noopPatch = () => {};

const DriverStatusContext = createContext({
  driverStatus: null,
  refetchDriverStatus: noop,
  patchDriverStatus: noopPatch,
  onSkippedPhoneVerify: () => {},
});

export function DriverStatusProvider({ value, children }) {
  return (
    <DriverStatusContext.Provider value={value}>
      {children}
    </DriverStatusContext.Provider>
  );
}

export function useDriverStatus() {
  return useContext(DriverStatusContext);
}

