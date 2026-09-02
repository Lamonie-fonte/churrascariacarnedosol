update public.products
set image_url = '/products/' || regexp_replace(image_url, '^.*/', '')
where image_url like 'https://carnedosol.envoi.com.br/midias/%';
