insert into public.job_categories (name) values
  ('Information Technology'), ('Sales'), ('Customer Support'), ('Operations'),
  ('Administration'), ('Manufacturing')
on conflict (name) do nothing;

-- Locations (all of India) are created by migration 202611260001_pan_india_locations.

insert into public.skills (name) values
  ('Customer support'), ('CRM'), ('English'), ('Inside sales'),
  ('Lead qualification'), ('Operations'), ('Microsoft Excel'),
  ('Vendor coordination'), ('JavaScript'), ('React'), ('SQL')
on conflict (name) do nothing;
