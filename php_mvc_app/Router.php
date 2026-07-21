<?php
class Router {
    private $routes = [];

    public function __construct() {
        $this->routes = [
            '/' => ['controller' => 'HomeController', 'action' => 'index'],
            '/about' => ['controller' => 'AboutController', 'action' => 'index'],
            '/contact' => ['controller' => 'ContactController', 'action' => 'index']
        ];
    }

    public function dispatch($uri) {
        $uri = parse_url($uri, PHP_URL_PATH);
        
        if (isset($this->routes[$uri])) {
            $route = $this->routes[$uri];
            $controllerName = $route['controller'];
            $actionName = $route['action'];
            
            $controllerFile = CONTROLLERS_PATH . '/' . $controllerName . '.php';
            
            if (file_exists($controllerFile)) {
                require_once $controllerFile;
                $controller = new $controllerName();
                
                if (method_exists($controller, $actionName)) {
                    $controller->$actionName();
                } else {
                    $this->error404();
                }
            } else {
                $this->error404();
            }
        } else {
            $this->error404();
        }
    }

    private function error404() {
        http_response_code(404);
        echo "404 - Page Not Found";
    }
}
