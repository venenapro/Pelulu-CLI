<?php
class HomeController {
    public function index() {
        $data = [
            'title' => 'Welcome to PHP MVC',
            'message' => 'This is a modular and scalable PHP MVC application!'
        ];
        $this->render('home', $data);
    }

    private function render($view, $data = []) {
        extract($data);
        require VIEWS_PATH . '/' . $view . '.php';
    }
}
