import React, { createContext, PropsWithChildren, useContext, useMemo, useState } from 'react';

type DemoState = {
  appliedJobs: string[]; invitedCandidates: string[]; discoveryEnabled: boolean;
  apply: (jobId: string) => void; invite: (candidateId: string) => void;
  setDiscoveryEnabled: (enabled: boolean) => void;
};

const DemoContext = createContext<DemoState | null>(null);

export function DemoProvider({ children }: PropsWithChildren) {
  const [appliedJobs, setAppliedJobs] = useState<string[]>([]);
  const [invitedCandidates, setInvitedCandidates] = useState<string[]>([]);
  const [discoveryEnabled, setDiscoveryEnabled] = useState(true);
  const value = useMemo(() => ({
    appliedJobs, invitedCandidates, discoveryEnabled,
    apply: (jobId: string) => setAppliedJobs((v) => v.includes(jobId) ? v : [...v, jobId]),
    invite: (candidateId: string) => setInvitedCandidates((v) => v.includes(candidateId) ? v : [...v, candidateId]),
    setDiscoveryEnabled,
  }), [appliedJobs, invitedCandidates, discoveryEnabled]);
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo() {
  const value = useContext(DemoContext);
  if (!value) throw new Error('useDemo must be used within DemoProvider');
  return value;
}
