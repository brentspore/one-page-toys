# One Page Toys — the static site, served by nginx.
#
# There is no build step: the repo IS the site. This image just copies it
# behind a web server, the same way Vercel serves it in production.
#
#   docker build -t one-page-toys .
#   docker run --rm -p 8080:8080 one-page-toys      -> http://localhost:8080
#
# For day-to-day editing, `docker compose up` instead: it mounts the working
# tree, so a saved file shows up on reload without rebuilding.
FROM nginx:1.27-alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY . /usr/share/nginx/html
# the nginx config rode in with the site; it is not a page
RUN rm -rf /usr/share/nginx/html/docker

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
