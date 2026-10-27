FROM alpine:3.20
RUN apk add --no-cache tinyproxy curl && \
    mkdir -p /var/log/tinyproxy /var/run/tinyproxy /etc/tinyproxy
COPY tinyproxy.conf /etc/tinyproxy/tinyproxy.conf
RUN chown -R nobody:nobody /var/log/tinyproxy /var/run/tinyproxy /etc/tinyproxy
EXPOSE 8888
USER nobody
CMD ["tinyproxy", "-d"]
