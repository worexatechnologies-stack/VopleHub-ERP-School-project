FROM postgres:16-alpine

RUN apk add --no-cache bash python3 py3-cryptography
COPY backup_encrypt.py /usr/local/bin/backup_encrypt.py
RUN chmod 0755 /usr/local/bin/backup_encrypt.py
