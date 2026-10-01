FROM alpine:3.20

# postgresql-client provides pg_dump; rclone uploads the dump to any
# S3/B2/GDrive/Spaces remote configured via rclone.conf. tzdata keeps the cron
# schedule in the expected local time.
RUN apk add --no-cache postgresql16-client rclone tzdata

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY run-backup.sh /usr/local/bin/run-backup.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/run-backup.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
