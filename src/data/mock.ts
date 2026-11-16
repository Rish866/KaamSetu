export type Job = {
  id: string; title: string; company: string; location: string; workMode: string;
  salary: string; score: number; skills: string[]; reasons: string[]; verified: boolean; posted: string;
};

export const jobs: Job[] = [
  { id: 'job-1', title: 'Customer Success Executive', company: 'HarbourCloud Technologies', location: 'Navi Mumbai', workMode: 'Hybrid', salary: '₹5.4–7.2 LPA', score: 92, skills: ['Customer support', 'CRM', 'English'], reasons: ['5 of 5 core skills match', 'Salary fits your expectation', '11 km from your preferred area'], verified: true, posted: 'Posted 2 days ago' },
  { id: 'job-2', title: 'Inside Sales Specialist', company: 'KiteRoute Logistics', location: 'Thane', workMode: 'On-site', salary: '₹4.8–6.6 LPA', score: 84, skills: ['Inside sales', 'Lead qualification', 'CRM'], reasons: ['Strong sales experience match', 'Salary range overlaps', 'Immediate joiners preferred'], verified: true, posted: 'Posted today' },
  { id: 'job-3', title: 'Operations Coordinator', company: 'BlueMango Foods', location: 'Pune', workMode: 'Hybrid', salary: '₹5.0–6.0 LPA', score: 76, skills: ['Operations', 'Excel', 'Vendor coordination'], reasons: ['Transferable operations experience', 'Pune is a preferred city', '1 skill needs review'], verified: true, posted: 'Posted 4 days ago' },
];

export const candidates = [
  { id: 'c1', initials: 'AS', name: 'Aarav S.', title: 'Customer Success Executive', location: 'Navi Mumbai', experience: '3.2 years', expected: '₹6.0 LPA', score: 94, skills: ['CRM', 'Customer support', 'Renewals'] },
  { id: 'c2', initials: 'PM', name: 'Priya M.', title: 'Inside Sales Associate', location: 'Thane', experience: '2.6 years', expected: '₹5.8 LPA', score: 89, skills: ['Inside sales', 'HubSpot', 'English'] },
  { id: 'c3', initials: 'RN', name: 'Rohan N.', title: 'Operations Executive', location: 'Pune', experience: '4 years', expected: '₹6.5 LPA', score: 81, skills: ['Excel', 'Vendors', 'Logistics'] },
];

export const pipeline = [
  { label: 'Applied', value: 18, color: '#DFF4EF' }, { label: 'Shortlisted', value: 7, color: '#DDE9FF' },
  { label: 'Interview', value: 4, color: '#FFF1D5' }, { label: 'Offer', value: 1, color: '#FCE2DA' },
];

export const pendingCompanies = [
  { id: 'v1', name: 'Maverick Auto Components', city: 'Pune', submitted: '18 min ago', evidence: 'GSTIN + company email' },
  { id: 'v2', name: 'SeaLink Customer Care', city: 'Mumbai', submitted: '2 hours ago', evidence: 'CIN + website domain' },
];
