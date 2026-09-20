FROM debian:12-slim

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends openssh-server \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /bin/bash e2e \
    && echo 'e2e:e2e-password' | chpasswd \
    && mkdir -p /run/sshd \
    && sed -ri 's/^#?PasswordAuthentication .*/PasswordAuthentication yes/' /etc/ssh/sshd_config \
    && sed -ri 's/^#?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config \
    && sed -ri 's@^#?Subsystem[[:space:]]+sftp.*@Subsystem sftp /usr/lib/openssh/sftp-server@' /etc/ssh/sshd_config

EXPOSE 22

# Deliberately internal-only: docker-compose.e2e.yml publishes no SSH port.
CMD ["/usr/sbin/sshd", "-D", "-e"]
