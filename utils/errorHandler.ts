
const errorHandler = (err: any, req: any, res: any, next: any) => {
    console.error(err);  // Log error information for debugging
    res.status(err.status || 500).json({
      error: {
        message: err.message || 'Something went wrong.',
        status: err.status || 500
      }
    });
  };
  
  export default errorHandler;
  