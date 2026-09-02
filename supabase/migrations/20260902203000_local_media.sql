-- Keep the production storefront independent from the source menu host.
update public.products
set image_url = '/products/' || regexp_replace(image_url, '^.*/', '')
where image_url like 'https://carnedosol.envoi.com.br/midias/item/%';

update public.store_settings
set logo_url = '/assets/logo-carne-de-sol.jpg',
    updated_at = now()
where id = true;
