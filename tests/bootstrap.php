<?php

use Symfony\Component\Dotenv\Dotenv;

require dirname(__DIR__).'/vendor/autoload.php';

if (method_exists(Dotenv::class, 'bootEnv')) {
    (new Dotenv())->bootEnv(dirname(__DIR__).'/.env');
}

if ($_SERVER['APP_DEBUG']) {
    umask(0000);
}

// Conversaciones del asistente de corridas anteriores (cuentan para los límites de uso por IP).
foreach (glob(dirname(__DIR__).'/var/assistant-test/*.json') ?: [] as $file) {
    unlink($file);
}
