insert into public.job_categories (name) values
  ('Information Technology'), ('Sales'), ('Customer Support'), ('Operations'),
  ('Administration'), ('Manufacturing')
on conflict (name) do nothing;

insert into public.locations (city, locality) values
  ('Mumbai', null), ('Mumbai', 'Andheri'), ('Mumbai', 'Powai'),
  ('Navi Mumbai', null), ('Navi Mumbai', 'Vashi'), ('Navi Mumbai', 'Airoli'),
  ('Thane', null), ('Pune', null), ('Pune', 'Hinjawadi'), ('Pune', 'Kharadi')
on conflict (city, locality) do nothing;

insert into public.skills (name) values
  ('Customer support'), ('CRM'), ('English'), ('Inside sales'),
  ('Lead qualification'), ('Operations'), ('Microsoft Excel'),
  ('Vendor coordination'), ('JavaScript'), ('React'), ('SQL')
on conflict (name) do nothing;
