<?php
require_once 'config.php';
require_once 'Router.php';

$router = new Router();
$router->dispatch($_SERVER['REQUEST_URI']);
