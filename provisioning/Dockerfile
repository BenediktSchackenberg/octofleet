FROM alpine:3.19

# Install dnsmasq (DHCP/TFTP) + nginx (HTTP) + tools
RUN apk add --no-cache \
    dnsmasq \
    nginx \
    curl \
    wget \
    bash \
    gettext \
    ca-certificates \
    && mkdir -p /tftpboot /srv/images /srv/drivers /srv/answers /srv/scripts \
    && mkdir -p /run/nginx

# nginx config for serving images
COPY nginx.conf /etc/nginx/nginx.conf.template

# iPXE boot script template
COPY boot.ipxe /etc/octofleet/boot.ipxe.template
COPY tftpboot/*.ipxe /etc/octofleet/tftp-templates/
COPY tftpboot/grub/*.cfg /etc/octofleet/tftp-templates/grub/

# Windows checkouts must produce the same boot scripts as Linux checkouts.
RUN find /etc/octofleet -type f -exec sed -i 's/\r$//' {} \; \
    && sed -i 's/\r$//' /etc/nginx/nginx.conf.template

# Startup script
COPY entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

EXPOSE 69/udp 4011/udp 9080/tcp

ENTRYPOINT ["/entrypoint.sh"]
