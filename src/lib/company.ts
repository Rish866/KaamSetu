import { unwrap, useLoad } from '../components/kit';
import { supabase } from './supabase';

export type Company = {
  id: string; legal_name: string; display_name: string; website: string | null; description: string | null; city: string | null; industry: string | null;
  company_size: string | null; registered_address: string | null; operating_locations: string[]; verification_status: 'draft' | 'pending' | 'approved' | 'rejected' | 'suspended'; verification_reason: string | null;
};
export type Membership = { role: 'owner' | 'recruiter' | 'viewer'; company: Company };

/** The signed-in employer's active company membership, straight from the database. */
export function useMembership(userId: string) {
  return useLoad(async (): Promise<Membership | null> => {
    const row = unwrap(await supabase.from('company_members').select('role, companies(*)').eq('user_id', userId).eq('active', true).maybeSingle());
    if (!row) return null;
    return { role: row.role as Membership['role'], company: row.companies as unknown as Company };
  }, [userId]);
}
export const canAct = (m: Membership | null) => Boolean(m && m.role !== 'viewer' && m.company.verification_status === 'approved');
