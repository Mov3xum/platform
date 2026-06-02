FROM alpine:3.20

ARG PB_VERSION=0.23.4

# su-exec används för att starta som root (chown:a den monterade pb_data-volymen)
# och sedan SLÄPPA privilegier → själva pocketbase-processen kör som non-root
# (säkerhetsgranskning 2026-06, H7 / ISO 27001 A.8.9). En PB-RCE/container-escape
# kör då inte längre som root.
RUN apk add --no-cache \
        ca-certificates \
        unzip \
        wget \
        su-exec \
    && wget -O /tmp/pb.zip \
        "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip" \
    && unzip /tmp/pb.zip -d /pb \
    && rm /tmp/pb.zip \
    && chmod +x /pb/pocketbase \
    && addgroup -S pb \
    && adduser -S -G pb -H -h /pb pb

RUN mkdir -p /pb/pb_migrations /pb/pb_hooks /pb_data
COPY . /tmp/build_context
RUN if [ -d /tmp/build_context/backend/pocketbase-schema/migrations ]; then \
            cp -R /tmp/build_context/backend/pocketbase-schema/migrations/. /pb/pb_migrations/; \
        elif [ -d /tmp/build_context/migrations ]; then \
            cp -R /tmp/build_context/migrations/. /pb/pb_migrations/; \
        else \
            echo "migrations directory not found in build context" && exit 1; \
        fi \
        && if [ -d /tmp/build_context/backend/pocketbase-schema/hooks ]; then \
            cp -R /tmp/build_context/backend/pocketbase-schema/hooks/. /pb/pb_hooks/; \
        elif [ -d /tmp/build_context/hooks ]; then \
            cp -R /tmp/build_context/hooks/. /pb/pb_hooks/; \
        fi \
        && rm -rf /tmp/build_context

# Gör /pb + /pb_data ägda av non-root-användaren (gäller färska volymer; en
# redan existerande volym chown:as av entrypointen vid start).
RUN chown -R pb:pb /pb /pb_data

# Entrypoint: om vi startar som root, chown:a den monterade volymen och kör
# sedan kommandot som `pb` via su-exec (privilegie-drop). Startar vi redan som
# non-root körs kommandot direkt.
RUN printf '%s\n' \
        '#!/bin/sh' \
        'set -e' \
        'if [ "$(id -u)" = "0" ]; then' \
        '  chown -R pb:pb /pb_data 2>/dev/null || true' \
        '  exec su-exec pb "$@"' \
        'fi' \
        'exec "$@"' \
        > /usr/local/bin/docker-entrypoint.sh \
    && chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8080

# /pb_data is the only path that needs persistent volume.
# Migrations + hooks are baked into the image; redeploy to apply changes.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["/pb/pocketbase", "serve", \
     "--http=0.0.0.0:8080", \
     "--dir=/pb_data", \
     "--migrationsDir=/pb/pb_migrations", \
     "--hooksDir=/pb/pb_hooks"]
