# Blockk Studio — imagen de producción (PHP 8.4 + Apache). Sin base de datos: el proyecto se guarda en el navegador.
# Variables en tiempo de ejecución: APP_SECRET (obligatoria), DEFAULT_URI (URL pública, opcional).
FROM php:8.4-apache

RUN apt-get update \
    && apt-get install -y --no-install-recommends unzip \
    && rm -rf /var/lib/apt/lists/* \
    && docker-php-ext-install opcache \
    && { \
        echo 'opcache.enable=1'; \
        echo 'opcache.memory_consumption=128'; \
        echo 'opcache.max_accelerated_files=20000'; \
        echo 'opcache.validate_timestamps=0'; \
        echo 'realpath_cache_size=4096K'; \
        echo 'realpath_cache_ttl=600'; \
        echo 'expose_php=Off'; \
    } > /usr/local/etc/php/conf.d/blockk.ini

# Apache en el puerto 8080, sirviendo public/ con el front controller de Symfony.
RUN sed -i 's/^Listen 80$/Listen 8080/' /etc/apache2/ports.conf \
    && { \
        echo '<VirtualHost *:8080>'; \
        echo '    DocumentRoot /var/www/app/public'; \
        echo '    <Directory /var/www/app/public>'; \
        echo '        AllowOverride None'; \
        echo '        Require all granted'; \
        echo '        FallbackResource /index.php'; \
        echo '    </Directory>'; \
        echo '    <Directory /var/www/app/public/assets>'; \
        echo '        FallbackResource disabled'; \
        echo '        Header set Cache-Control "public, max-age=31536000, immutable"'; \
        echo '    </Directory>'; \
        echo '    ErrorLog ${APACHE_LOG_DIR}/error.log'; \
        echo '    CustomLog ${APACHE_LOG_DIR}/access.log combined'; \
        echo '</VirtualHost>'; \
    } > /etc/apache2/sites-available/000-default.conf \
    && a2enmod headers

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

ENV APP_ENV=prod \
    APP_DEBUG=0 \
    COMPOSER_ALLOW_SUPERUSER=1

WORKDIR /var/www/app

COPY composer.json composer.lock symfony.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-interaction --no-progress

COPY . .
# Con scripts: genera vendor/autoload_runtime.php y corre cache:clear, assets:install e importmap:install.
RUN APP_SECRET=build composer install --no-dev --classmap-authoritative --prefer-dist --no-interaction --no-progress \
    && APP_SECRET=build php bin/console asset-map:compile \
    && APP_SECRET=build php bin/console cache:warmup \
    && chown -R www-data:www-data var

EXPOSE 8080
