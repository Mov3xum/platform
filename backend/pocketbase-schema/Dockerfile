FROM alpine:3.20

ARG PB_VERSION=0.23.4

RUN apk add --no-cache \
        ca-certificates \
        unzip \
                wget \
    && wget -O /tmp/pb.zip \
        "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip" \
    && unzip /tmp/pb.zip -d /pb \
    && rm /tmp/pb.zip \
    && chmod +x /pb/pocketbase

RUN mkdir -p /pb/pb_migrations /pb/pb_hooks
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

EXPOSE 8080

# /pb_data is the only path that needs persistent volume.
# Migrations + hooks are baked into the image; redeploy to apply changes.
CMD ["/pb/pocketbase", "serve", \
     "--http=0.0.0.0:8080", \
     "--dir=/pb_data", \
     "--migrationsDir=/pb/pb_migrations", \
     "--hooksDir=/pb/pb_hooks"]
