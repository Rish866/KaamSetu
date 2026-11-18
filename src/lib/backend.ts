import { supabase } from './supabase';

export type LaunchData = {
  categories: string[];
  cities: string[];
  skills: string[];
};

export async function loadLaunchData(): Promise<LaunchData> {
  const [categories, locations, skills] = await Promise.all([
    supabase.from('job_categories').select('name').eq('active', true).order('name'),
    supabase.from('locations').select('city').eq('active', true).order('city'),
    supabase.from('skills').select('name').eq('active', true).order('name'),
  ]);

  const firstError = categories.error ?? locations.error ?? skills.error;
  if (firstError) throw firstError;

  return {
    categories: (categories.data ?? []).map((item) => item.name),
    cities: [...new Set((locations.data ?? []).map((item) => item.city))],
    skills: (skills.data ?? []).map((item) => item.name),
  };
}
