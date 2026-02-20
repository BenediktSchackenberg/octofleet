FROM alpine:3.19

# Install dnsmasq (DHCP/TFTP) + nginx (HTTP) + tools
RUN apk add --no-cache \
    dnsmasq \
    nginx \
    curl \
    wget \
    bash \
    && mkdir -p /tftpboot /srv/images /srv/drivers /srv/answers /srv/scripts \
    && mkdir -p /run/nginx

# nginx config for serving images
COPY nginx.conf /etc/nginx/nginx.conf

# iPXE boot script template
COPY boot.ipxe /tftpboot/boot.ipxe

# Startup script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 69/udp 4011/udp 8888/tcp

ENTRYPOINT ["/entrypoint.sh"]
