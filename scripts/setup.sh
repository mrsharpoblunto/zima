#!/bin/bash
if [ "$(whoami)" != "root" ]; then
	echo "Sorry, you are not root. Re-run this script using sudo"
	exit 1
fi

# install dependencies
apt-get update
apt-get install openssl libavahi-compat-libdnssd-dev libgpiod-dev curl unzip nodejs npm

setcap 'cap_sys_nice=eip' $(which node)
setcap 'cap_net_bind_service=+ep' $(which node)

# build the app & web client
npm install
npm run build:client
npm run build:server

# generate self signed ssl certs
ip address show | grep -Po '(?<=inet )\d*.\d*.\d*.\d*.(?=/)' | while read -r line
do
    if [[ $line != '127.0.0.1' ]]; then
        echo $line
        mkdir ssl
        openssl req -x509 -nodes -days 3650 -newkey rsa:2048 -subj "/C=US/CN=$line" -keyout ssl/server.key -out ssl/server.crt
        break
    fi
done
chmod +r ssl/server.key

# set the app-server to auto start on boot
cp scripts/systemd.conf /etc/systemd/system/zima.service
cwd=$(pwd)
sed -i.bak 's|CWD|'"$cwd"'|g' /etc/systemd/system/zima.service
rm /etc/systemd/system/zima.service.bak
systemctl enable zima

# add cron job to check for updates every 15 minutes
cron_job="*/15 * * * * cd $cwd && ./scripts/update.sh >> /var/log/zima-update.log 2>&1"
(crontab -l 2>/dev/null | grep -v "zima"; echo "$cron_job") | crontab -
