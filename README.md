A Raspberry Pi powered pool cover automation app. Allows you to remotely open a pool cover (or any electrically powered door really) via a web-app or HomeKit automation. Check out https://sharpoblunto.com/News/2025/10/03/zima-blue for more information on how to hook this up to actual hardware.

# Installing

- run `scripts/setup.sh`
- run `systemctl restart zima`

# Configuration

## Hardware

You'll need to connect the 3.3v signals from the pool cover motors open, close, limit-open, & limit-close wires. The pins you use for
each of these is set in src/server/config.ts. These need to match the GPIO port pinout number from the particular Raspberry PI model you're using.

## Using LetsEncrypt

To use a real SSL certificate requires a few config changes and some additional configuration (assuming you're using cloudflare).

- `sudo apt install certbot`
- `sudo apt install python3-certbot-dns-cloudflare`
- Create a file in `/etc/letsencrypt/cloudflare.ini`

```
# Cloudflare example
dns_cloudflare_email = your-email@example.com
dns_cloudflare_api_key = your-api-key
```

- Secure the credentials file `sudo chmod 600 /etc/letsencrypt/cloudflare.ini`
- Request your certificate

```
sudo certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
  -d yourdomain.com
```

- Check that automatic renewal works `sudo certbot renew --dry-run`
- Ensure lumiere has access to the certs

```
# Create a new group
sudo groupadd sslcerts

# Add your user to the group
sudo usermod -a -G sslcerts $USER

# Change group ownership of the certificates directory
sudo chgrp -R sslcerts /etc/letsencrypt/live
sudo chgrp -R sslcerts /etc/letsencrypt/archive

# Set permissions to allow group read
sudo chmod -R g+rX /etc/letsencrypt/live
sudo chmod -R g+rX /etc/letsencrypt/archive
```

- Update src/server/config.ts SSL_KEY and SSL_CERT paths

```
export const SSL_KEY =
  '/etc/letsencrypt/live/yourdomain.com/privkey.pem';
export const SSL_CERT =
  '/etc/letsencrypt/live/yourdomain.com/fullchain.pem';
```

- Add an update renewal hook at `/etc/letsencrypt/renewal-hooks/post/restart-lumiere.sh`

```
#!/bin/bash
systemctl restart lumiere
```

- Make it executable `sudo chmod +x /etc/letsencrypt/renewal-hooks/post/restart-nodejs.sh`
- Test that cert renewal works `sudo certbot renew --dry-run`
